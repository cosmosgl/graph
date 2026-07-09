<!-- suggested path: history/2026/2026-06-27-nan-point-removal.md -->

# `NaN` positions for stable-identity point removal and addition

**Commits:** 9931bd8, 3985df6, e0a2a0b, f1768c1, 9575554, 12e8219, 04e5a64, 2b754a9,
607df91, ae2d44e, 83e069f, 31f3289, 2488f26, 6b8e6a6

## Why

A point's identity in cosmos.gl is its array index. Removing a point by shrinking
the array renumbers every later point, and because the transition animates **per
index**, they all slide into their neighbour's old spot. That's correct for the
"compact" mental model, but callers who add/remove points wanted the opposite: the
removed point disappears, the **rest hold still**, and adds/removes **animate**.

This adds an opt-in way to express that, plus the engine work to make it safe. It's
additive — compacting the array still works exactly as before. A deep review pass
before release hardened the feature end to end (the later commits above): every
consumer of positions — physics, picking, links, zoom, read-backs — now agrees on
what "absent" means.

## The model: `NaN` tombstones

Instead of compacting, set a removed point's **position to `NaN`** (a value a
`Float32Array` can hold). The slot stays — identity is preserved — and `NaN` means
"absent". Adding is the mirror: a slot crosses `NaN → real`.

```ts
// remove: point fades out, others don't move
positions[i * 2] = NaN; positions[i * 2 + 1] = NaN
graph.setPointPositions(positions)
```

Absence means `NaN` in **either** coordinate, defined once: the shared
`isPointAbsent` helper (`src/helper.ts`) is the CPU-side predicate, and
`buildPositionTextureData` normalizes a half-NaN position to fully-NaN so the GPU
never sees a partial one. (Before this, absence was keyed on `x` only at most sites —
a point with a real `x` and `NaN` `y` passed every guard and its `NaN` cascaded
through the spring/centroid sums until the whole layout died.)

## Fade in / out

A `NaN` position alone fades a point out — the engine handles it:

- **Freeze.** `interpolate-position.frag` can't `mix()` toward/from `NaN`, so it holds
  the real side: freeze at source on exit, appear at target on enter. The dot never
  moves; the fade is carried by **size/opacity**.
- **Read-time resolution.** Input size/color arrays are used **verbatim** — cosmos
  never edits or copies them, so "use the default" stays encoded as `NaN` all the way
  to the GPU. The draw shader resolves a `NaN` channel against the animated exit
  ramp: `mix(configDefault, EXIT_DEFAULT, exit)` — the config default while present,
  fading to the exit default (size 0, transparent) as the point leaves. Explicit
  (real) values pass through: passing size/color *overrides the look* (custom exit).
- Because the ramp drives the default fade itself, a removal needs **no size/color
  transition**: `setPointPositions` queues only `Positions`, and **hover picking
  stays live during bare-removal fades**. (A custom exit look calls
  `setPointSizes`/`setPointColors`, whose transitions pause hover as they always
  have.)
- `EXIT_DEFAULT_SIZE` / `EXIT_DEFAULT_COLOR_CHANNEL` live once in `variables.ts`,
  imported by the CPU mirrors (`GraphData.getResolvedPointSize`/
  `getResolvedPointColorChannel` — used by collision sizing, rect-selection sizing,
  the hover/focus ring, image-size fallback, read-backs) and injected into the
  shader as `#define`s (formatted as exact float literals).

| add (`NaN → real`) | remove (`real → NaN`) |
|---|---|
| grow + fade in | shrink + fade out |
| fade in at full size | fade out at full size |
| recolor in | recolor out |
| snap in | snap out |

## The exit texture (one signal for two pipelines)

The fade freeze erases the `NaN` from the live position, so absence must be tracked
as explicit engine state. A single per-point **exit texture** does it:
`R = previous absence`, `G = current absence` (`1` = `NaN` position), rebuilt from
positions in `Points.updateExit()`. It is `rg32float` — two channels are all the
state there is.

- **Draw** (`draw-points.vert`): `exit = mix(R, G, transitionProgress)` — skips the
  point at `exit >= 1` and resolves `NaN` size/color channels along the ramp (above).
  Gated on `animatePositions` — outside a position transition it reads settled `G`,
  so an unrelated color/size update can't replay the ramp.
- **Physics**: read `G` to exclude absent points.

`exit` is "how gone is this point, 0→1, animated across the transition" — `mix`
blends from absence-at-start (`R`) to absence-now (`G`):

| R (was) | G (now) | meaning | `exit` |
|---|---|---|---|
| 0 | 0 | stays present | `0` — drawn |
| 0 | 1 | leaving | `0 → 1` — ramps out |
| 1 | 0 | entering | `1 → 0` — ramps in |
| 1 | 1 | stays gone | `1` — skipped |

A leaving point stays drawn (`exit < 1`) through the fade and is dropped only at the
end — that window is what lets you see it fade rather than blink out. Both channels
are needed: a single "absent now" bit can't tell leaving from entering from stable.

While no point is (or was) absent — every graph that never uses `NaN` —
`exitTexture` is a **1×1 all-zero stand-in**: any sample returns "present", the
single texel stays cache-resident so the per-vertex fetch in the hot shaders costs
~nothing, and the full-size texture is never allocated at all.

## Simulation safety

Forces are reductions over all points, so one `NaN` would poison the whole layout in
a tick (centroid = Σ positions, etc.) and the integrator's `clamp(NaN)` could
resurrect a dead point at (0,0). All position-reading passes read the exit
texture's `G` and skip absent points:

- `update-position.frag` — leave absent points untouched (no integrate, no clamp).
- `calculate-centermass.vert` (ForceCenter, Clusters) and `calculate-level.vert`
  (ForceManyBody) — cull absent points from the centroid/grid.
- `build-grid.vert` (ForceCollision) — keep absent points out of the collision grid.
- `force-spring.ts` (ForceLink) — skip a spring to an absent point.

Gravity/mouse/drag are per-point, so the integrator skip covers them. Works with the
simulation on or off.

## Links follow their points

A link is as absent as its endpoints — there is no per-link absence state.
`draw-curve-line.vert` samples the exit texture for both endpoints: the visible pass
multiplies link opacity by `(1 − exitA)(1 − exitB)` using the same animated ramp as
the point fade (links fade out/in in sync with their endpoint), and the picking pass
(`renderMode > 0`, same shader) drops a link as soon as an endpoint is currently
absent — matching point picking. The `isnan` endpoint guard stays as a snap-path
backstop. Callers only actually drop a removed point's links when they compact.

## `render(simulationAlpha?, transitionDuration?)`

`render` takes a second optional argument: the duration (ms) for any transition this
render starts, for this call only. `0` snaps. Mainly for **compaction** — after points
fade out you drop the tombstones and renumber, which must snap (an animated renumber
would re-introduce the slide); since the surviving points keep their coordinates, a
snapped renumber shows zero movement.

```ts
graph.setPointPositions(compactedPositions) // [x0, y0, x1, y1, …]
graph.setPointColors(compactedColors)        // [r0, g0, b0, a0, …], same update → also snaps
graph.render(undefined, 0)                    // snap this update only
```

Three durations, three scopes: `config.transitionDuration` (the default),
the render override (this call only), and `activeDuration` (frozen at `start()`,
pacing the running animation). The `duration` getter resolves the commit scope only
(`override ?? config`) and `start()` consumes that same getter, so the pipeline's
animate-vs-snap prediction can never disagree with what `start()` does. A transition
already playing keeps its own length — which also means changing
`config.transitionDuration` mid-flight no longer retimes (or cancels) a running
transition; to end one immediately, apply an update with `render(undefined, 0)`.
An earlier iteration exposed a stateful `setNextTransitionDuration(ms?)` setter; it
was folded into this argument before release.

## Absent points are gone everywhere

The fade freezes an absent point at its last real position, so without guards it
would stay "hittable" and readable forever. Every consumer now agrees it is gone:

- **hover** (`find-hovered-point.vert`) — no ring on a removed point, and hover
  stays live during bare-removal fades (a removal alone activates no size/color
  transition),
- **rect / polygon selection** (`find-points-in-rect`/`-in-polygon`),
- **highlight / outline draw** (`draw-highlighted.vert`),
- **point & link sampling** (`fill-sampled-points` / `fill-sampled-links`),
- **zoom / fitView** — `zoomToPointByIndex` is a no-op for an absent point, and the
  camera math is total: `Zoom.getTransform`/`getMiddlePointTransform` skip non-finite
  positions and keep the current view when no finite extent remains, so the canvas
  transform can never go `NaN` (even with every point removed),
- **read-backs** — `getPointPositions` / `getTrackedPointPositionsArray` report
  `NaN` for absent slots (kept for index alignment); `getTrackedPointPositionsMap`
  omits the key. The GPU texture intentionally keeps the frozen coordinate (the fade
  renders from it); only the read-back layer reinterprets.

## Other fixes pulled in

- `rescaleInitialNodePositions` excludes `NaN` points from the bounding box — a single
  absent point used to collapse the whole layout (`Math.min(x, NaN) = NaN`). The
  degenerate single-point box is handled (centered instead of `NaN`-scaled), and the
  all-absent early return clears `scaleX`/`scaleY` so `getScaleX()`/`getScaleY()`
  never report a previous dataset's mapping.
- `getPointColors` / `getPointSizes` return an **as-rendered snapshot** computed on
  demand (a new array, safe to mutate) instead of aliasing the live internal buffer.

## Migration

Non-breaking and additive — no API signatures changed, and graphs without `NaN`
positions render and simulate identically. Behavior notes:

- A `NaN` position went from *undefined/broken* to *a defined "absent" feature*.
- `NaN` in a size/color array still resolves to the config default for a **present**
  point; it only means the exit default for an **absent** one — and since resolution
  happens at read time, the caller's **size/color arrays are never modified**, so a
  revived point's `NaN` channels re-resolve to config defaults as documented.
  (Positions are unchanged from main: with `rescalePositions` enabled the engine
  still writes scaled coordinates back into the positions array.)
- Changing `config.transitionDuration` no longer affects a transition already
  playing (it applies from the next one).

## Example

`src/stories/beginners/add-remove-points` (Storybook: **Examples / Beginners → Add &
Remove Points**) — a stable slot pool with `NaN` tombstones, links (a seed ring +
nearest-neighbor links that fade with their points), and a live data panel
(active vs. tombstoned slots). Demonstrates the full enter/exit matrix (each
enter style mirroring an exit style) and **Compact** (snapped renumber + link
remapping via `render(undefined, 0)`).

## Out of scope (by design)

- **Slot lifecycle / compaction** is the caller's, and cosmos does **not**
  auto-compact — by design. Only the caller knows what indices are tied to (ids,
  links, selection), so the engine renumbering underneath them would break those.
  Callers reuse freed slots on add, or **Compact** when convenient.
- **Interrupting a fade mid-flight snaps it** — a data update arriving during a fade
  re-derives the exit state, and the half-faded point completes instantly. This is
  the codebase-wide interruption rule ("a new update supersedes the in-flight
  animation"); smoothing it belongs to a future transition-system rework.
