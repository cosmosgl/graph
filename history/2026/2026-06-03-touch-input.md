<!-- suggested path: history/2026/2026-06-03-touch-input.md -->

# Touch input on phones and tablets

**Commits:** c4b93e1

## Why

Cosmos relied entirely on `mouse*` events for canvas interactions. On a phone or tablet that meant three concrete bugs and a feature gap:

- Tapping a point started a pan instead of dragging it — at `touchstart` no `pointermove` had fired yet, so `store.hoveredPoint` was undefined, `Drag.subject` returned `undefined`, and the gesture fell through to zoom.
- The first tap "hovered" the point and the second tap clicked it — synthesized mouse events left `hoveredPoint` populated between gestures, and there was no `mouseleave` on touch to clear it.
- The previously-tapped point stayed sticky — a tap on background after tapping a point would either drag the previous point or fire `onPointClick` for it.
- `onContextMenu` / `onPointContextMenu` / `onLinkContextMenu` / `onBackgroundContextMenu` were unreachable on touch.

This entry covers the migration from mouse events to pointer events, plus a long-press recogniser for context menus, plus some adjacent fixes.

## Pointer events instead of mouse events

The canvas-level listeners changed:

| Before | After |
|---|---|
| `mouseenter.cosmos` | `pointerenter.cosmos` |
| `mousemove.cosmos`  | `pointermove.cosmos` |
| `mouseleave.cosmos` | `pointerleave.cosmos pointercancel.cosmos` |
| `mousemove` → `onMouseMove` | `pointermove` → `onPointerMove` |
| — | `pointerdown.cosmos` (new) |
| — | `pointerup.cosmos` (new) |

All handlers short-circuit on `!event.isPrimary` so the second finger of a pinch can't perturb tracked state or fire spurious callbacks. The `onMouseMove` **config callback** name is preserved for back-compat — only the internal method was renamed.

Internal field `_isMouseOnCanvas` → `_isPointerOnCanvas`. The `currentEvent` field stays typed as `… | MouseEvent | undefined` since `PointerEvent` is a structural subtype.

## Sync pick at touchstart

`pointerdown.cosmos` runs `findHoveredItem(true)` synchronously before d3-drag's `subject` filter runs, so `store.hoveredPoint` is correct at the instant the gesture starts. Without this, drag would still decline on touch.

```ts
.on('pointerdown.cosmos', (event: PointerEvent) => {
  if (!event.isPrimary) return
  this.currentEvent = event
  this._shouldSuppressNextClick = false
  // Touch fires no pointermove before touchstart, so hoveredPoint is empty
  // when d3-drag checks it. Pick here so drag starts, not zoom.
  // updateMousePosition first — findHoveredItem reads what it writes.
  this._lastMouseX = event.clientX
  this._lastMouseY = event.clientY
  this.updateMousePosition(event)
  this.findHoveredItem(true)
  // … (long-press timer set below for non-mouse pointers)
})
```

`findHoveredItem` gained an `immediate = false` parameter. When `true` it bypasses three gates: the `_isPointerOnCanvas` check, the `MAX_HOVER_DETECTION_DELAY` frame counter, and the `MIN_MOUSE_MOVEMENT_THRESHOLD` check. The `PointSizes` transition guard is **not** bypassed — picking is unreliable mid-transition regardless of who's asking.

This differs from the existing `_shouldForceHoverDetection` field, which only bypasses the movement check on the next eligible RAF tick. `immediate=true` is *now, from this code path*; `_shouldForceHoverDetection=true` is *next eligible RAF*.

## Hover sticks across `pointerleave` for touch

```ts
.on('pointerleave.cosmos pointercancel.cosmos', (event: PointerEvent) => {
  if (!event.isPrimary) return
  this.cancelLongPress()
  this._isPointerOnCanvas = false
  // Touch tap: pointerdown → pointerup → pointerleave → click
  // Clearing here would empty hoveredPoint before click reads it.
  // Keep it — the next tap overwrites it anyway.
  if (event.pointerType !== 'mouse') return
  // … mouse-only hover clear + onPointMouseOut + onLinkMouseOut + cursor reset
})
```

On a touch tap the browser fires `pointerdown → pointerup → pointerleave → click`. Touch pointers cease to exist on lift-off, which is why `pointerleave` arrives before the synthesized `click`. If the leave handler cleared `hoveredPoint`, every tap on a point would route to `onBackgroundClick`. The early return preserves hover long enough for `click` to read it; the next `pointerdown` re-picks synchronously, so stale state can't carry into a new gesture.

The mouse-only branch still clears hover and fires `onPointMouseOut` / `onLinkMouseOut` as before.

## Long-press → contextmenu on touch

New timer started in `pointerdown` for non-mouse pointers:

```ts
const LONG_PRESS_DURATION_MS = 500
const LONG_PRESS_MOVE_THRESHOLD_PX = 10
```

| Gesture | Behavior |
|---|---|
| Tap a point | `onPointClick` (unchanged from desktop semantics) |
| Hold a point ≥500ms within 10px | `onPointContextMenu`; the synthesized click is dropped |
| Hold the background ≥500ms | `onBackgroundContextMenu` |
| Hold then drift past 10px | Timer cancelled; gesture becomes pan/drag |
| Browser fires its own `contextmenu` (Android Chrome on some elements) | Timer cancelled, suppress flag set — we don't double-fire and any synthesized click is dropped |

Two helpers extracted to make this composable: `cancelLongPress()` and `fireContextMenu(event)` (the latter pulled out of `onContextMenu` so both the desktop right-click path and the long-press timer dispatch the same callback chain).

A new field `_shouldSuppressNextClick` is set by long-press fire (and by browser-fired `contextmenu`), consumed by `onClick` to drop one synthesized click, and reset on every new `pointerdown` so it can't leak across gestures.

## `touch-action` is config-aware

```ts
private updateCanvasTouchAction (): void {
  this.canvas.style.touchAction =
    this.config.enableDrag || this.config.enableZoom ? 'none' : ''
}
```

Called from init and from `updateZoomDragBehaviors`. A read-only embed with `enableDrag: false` and `enableZoom: false` leaves the canvas with no `touch-action` so the surrounding page can scroll over it; toggling either flag back to `true` at runtime via `setConfigPartial` reinstates `touch-action: none` automatically.

d3-drag sets `touch-action: none` on its own only while its behavior is attached — `updateCanvasTouchAction` covers the gap when drag is off but zoom is on, and the inverse.

## `event.which` deprecation

```ts
// Before
this.isRightClickMouse = event.which === 3
// After
this.isRightClickMouse = (event.buttons & 2) !== 0
```

`MouseEvent.which` is deprecated. `event.buttons` is a bitmask of currently-held buttons (bit 2 = right). It also has the right semantic during a `pointermove`: *is right button currently held* rather than *which button transitioned*. Touch reports `buttons = 0`, so `enableRightClickRepulsion` stays a desktop-only feature.

## Migration

- **`onMouseMove` now fires during touch gestures.** Previously it only fired after a touch ended (synthesized mousemove). Now it fires on every primary `pointermove`, matching desktop semantics — including during pinch and pan. Heavy callbacks may need their own throttle.
- **Tap behavior changed.** First-tap-on-point now fires `onPointClick`; the prior broken behavior (first tap "hovers", second tap clicks) is gone. Code that relied on it will see callbacks at different moments.
- **Touch can now reach contextmenu callbacks.** Long-press → `onContextMenu` / `onPointContextMenu` / `onLinkContextMenu` / `onBackgroundContextMenu`. Code that assumed these were desktop-only should be re-audited.
- **`event` passed to callbacks** is a `PointerEvent` (a subtype of `MouseEvent`) on the pointer-driven paths. `event.clientX` etc. still work; `instanceof MouseEvent` still passes.

No public API removals.

## Known caveats

- **Two fingers on a point start a drag, not a pinch.** When the first finger lands on a point, `Drag.subject` accepts before the second finger arrives. Acceptable trade-off — symmetric with the desktop constraint that a mouse cursor can't pinch a point either.
- **Tap during a `Positions` transition still picks.** `findHoveredItem(true)` guards on `PointSizes` transitions but not `Positions`. `Drag.subject` blocks drag on both, so no drag actually starts — but `hoveredPoint` gets written and the subsequent `click` may route to a point at its target position rather than its rendered position. Same caveat as desktop click during a transition.
- **Hover stays sticky between touch gestures.** Skipping the hover clear on touch `pointerleave` is deliberate. `store.hoveredPoint` remains populated until the next `pointerdown` overwrites it. Code reading hover state from outside the click handler may show a previously-tapped point.
