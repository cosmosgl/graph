<!-- suggested path: history/2026/2026-07-07-on-demand-rendering.md -->
# On-demand rendering

**Date:** 2026-07-07
**Commits:** `2b6629d`

## Why

cosmos.gl rendered on every `requestAnimationFrame`, forever — `frame()` unconditionally
re-scheduled itself even after the simulation ended and nothing on screen could change.
An idle graph kept the GPU busy and drained battery on pages that embed a visualization
and then just sit there. Rendering now happens only when something visual can actually
change; a static scene costs zero work per frame.

## What changed

All in `src/index.ts` — the Zoom, Drag, and Transition modules are untouched.

`frame()` is now an idempotent scheduler: it schedules a single RAF (no-op if one is
already pending), and the callback re-schedules only while `shouldKeepRendering()` is
true. A new private `requestRender()` is the funnel every visual-state event goes
through. `startFrames()` is gone; `stopFrames()` remains for `destroy()` and the
empty-data `render()` path.

### When the loop keeps running (`shouldKeepRendering()`)

| Condition | Why it needs continuous frames |
|---|---|
| `fpsMonitor` exists (`showFPSMonitor: true`) | gl-bench derives FPS from frame cadence; also doubles as a debug escape hatch |
| `store.isSimulationRunning` | forces step every tick (alpha floor still handled by `end()`) |
| `transition.isActive` | GPU interpolation advances per frame (`isPending` deliberately does *not* count — a queued-but-never-rendered transition must not keep the loop alive) |
| `dragInstance.isActive` | drag shader writes positions per frame |
| `zoomInstance.isRunning` | user gesture or programmatic d3 zoom transition in flight |
| `isRightClickMouse && enableRightClickRepulsion` | mouse repulsion runs **regardless of** `isSimulationRunning` in `runSimulationStep` |
| `hasPendingHoverWork()` | see hover throttle note below |

### One-shot render triggers (`requestRender()` call sites)

Pointer enter/move/leave/down (and the touch long-press re-pick), all three zoom and
drag `.detect` handlers, `setConfig`/`setConfigPartial` (one unconditional call at the
end of `updateStateFromConfig` — it applies colors/sizes/status/spaceSize/pixelRatio
immediately), `start()`/`unpause()`/`step()`, public `create()` (its contract is
"apply data without `render()`"), `setImageData`, `setPinnedPoints`, and `render()`
itself. `pause()`/`stop()` need no hook: the simulation step runs *before* the draw
within a frame, so the last state is always already drawn.

Programmatic zoom (`setZoomLevel`, `zoomToPointByIndex`, `fitView*`,
`setZoomTransformByPointPositions`) needs no duration bookkeeping — d3 transitions run
on d3's own timer and emit a `zoom` event every frame (synchronously for
`duration = 0`), and each event schedules a render.

## Details worth knowing

- **Canvas resize while idle.** `resizeCanvas()` used to detect CSS size changes by
  per-frame polling. A `ResizeObserver` on the canvas now schedules a redraw; the
  actual size/zoom-transform work still happens in the in-frame `resizeCanvas()`.
  Disconnected in `destroy()`.
- **Drag release needs one extra frame.** The drag GPU write happens *after* the draw
  pass in `renderFrame`, so the final drag position only becomes visible on the next
  frame — the drag `end.detect` hook schedules it. Without this, a released point
  snaps back visually by one frame's worth of movement.
- **Hover throttle vs. loop shutdown.** `findHoveredItem()` runs at most every 4
  frames and skips sub-2px movement. `hasPendingHoverWork()` keeps the loop alive
  (max ~5 frames) until detection actually executes — which updates the last-checked
  mouse position and consumes `_shouldForceHoverDetection`, turning the predicate
  false. Hover latency is identical to before; the loop just stops afterwards.
- **Stale-buffer guard.** `render()` with empty data stops frames but doesn't clear
  `pointsTextureSize`. `frame()` therefore refuses to schedule when
  `pointsNumber`/`linksNumber` are both zero, so a later pointermove can't resurrect
  drawing of stale GPU buffers.
- **External-device integrations** that relied on cosmos.gl redrawing the shared
  context every frame no longer get that for free — trigger a cosmos.gl-observable
  change (e.g. `render()`) when a redraw is needed.

## Example

`src/stories/experiments/on-demand-rendering.ts` (*Examples/Misc → On Demand
Rendering*): a mesh graph with a frame-counter overlay (patched
`requestAnimationFrame`, updated on a `setInterval` so it keeps reporting while cosmos
renders nothing). Watch the counter hit "idle" after the simulation decays, and resume
on hover, zoom, drag, or window resize. The story overrides `simulationDecay` — the
shared story config uses a decay so large the simulation would render practically
forever.
