<!-- suggested path: history/2026/2026-06-27-nan-point-removal.md -->

# `NaN` positions for stable-identity point removal and addition

**Commits:** 9931bd8, 3985df6, e0a2a0b, f1768c1, 9575554

## Why

A point's identity in cosmos.gl is its array index. Removing a point by shrinking
the array renumbers every later point, and because the transition animates **per
index**, they all slide into their neighbour's old spot. That's correct for the
"compact" mental model, but callers who add/remove points wanted the opposite: the
removed point disappears, the **rest hold still**, and adds/removes **animate**.

This adds an opt-in way to express that, plus the engine work to make it safe. It's
additive — compacting the array still works exactly as before.

## The model: `NaN` tombstones

Instead of compacting, set a removed point's **position to `NaN`** (a value a
`Float32Array` can hold). The slot stays — identity is preserved — and `NaN` means
"absent". Adding is the mirror: a slot crosses `NaN → real`.

```ts
// remove: point fades out, others don't move
positions[i * 2] = NaN; positions[i * 2 + 1] = NaN
graph.setPointPositions(positions)
```

## Fade in / out

A `NaN` position alone fades a point out — the engine handles it:

- **Freeze.** `interpolate-position.frag` can't `mix()` toward/from `NaN`, so it holds
  the real side: freeze at source on exit, appear at target on enter. The dot never
  moves; the fade is carried by **size/opacity**.
- **Exit-target resolution** (per point, in `GraphData`): no size/color array (or
  length mismatch) → exit default (size 0, transparent); a real value → use it
  (custom exit); `NaN` → exit default. So a bare `setPointPositions(…NaN…)` fades to
  nothing; passing size/color only *overrides the look*.
- `setPointPositions` queues the size/color transitions itself (no-op when unchanged)
  so the fade animates even without a `setPointSizes`/`setPointColors` call.

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
positions in `Points.updateExit()`.

- **Draw** (`draw-points.vert`): `exit = mix(R, G, transitionProgress)`, skip when
  `exit >= 1`. Gated on `animatePositions` — outside a position transition it reads
  settled `G`, so an unrelated color/size update can't replay the ramp.
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

A fast path (`isExitTextureAllZero`) skips the rebuild + GPU upload when nothing is
or was absent, so graphs that never use `NaN` pay ~nothing.

## Simulation safety

Forces are reductions over all points, so one `NaN` would poison the whole layout in
a tick (centroid = Σ positions, etc.) and the integrator's `clamp(NaN)` could
resurrect a dead point at (0,0). All position-reading passes now read the exit
texture's `G` and skip absent points:

- `update-position.frag` — leave absent points untouched (no integrate, no clamp).
- `calculate-centermass.vert` (ForceCenter, Clusters) and `calculate-level.vert`
  (ForceManyBody) — cull absent points from the centroid/grid.
- `force-spring.ts` (ForceLink) — skip a spring to an absent point.

Gravity/mouse/drag are per-point, so the integrator skip covers them. Works with the
simulation on or off.

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

`render` sets the duration on the transition (`setDurationOverride`) before the update
pipeline runs and `start()` consumes it. It must be visible in that window because the
pipeline (`Points.updatePositions`) reads it to choose animate vs. snap *before* `start()`
runs. Because `render` sets it before every `start()`, it can't carry into another render —
the leak the earlier approach was prone to. A transition already playing keeps its own
length (`step()` reads `activeDuration` directly). An earlier iteration exposed a stateful
`setNextTransitionDuration(ms?)` setter; it was folded into this argument before release.

## Picking, highlight & sampling exclude absent points

The fade freezes an absent point at its last real position (and `opacity`/`recolor`
exits keep its size), so it stays "hittable" until fully gone. Every consumer that
reads positions now reads the exit texture's `G` and skips absent points:

- **hover** (`find-hovered-point.vert`) — no ring on a removed point,
- **rect / polygon selection** (`find-points-in-rect`/`-in-polygon`),
- **highlight / outline draw** (`draw-highlighted.vert`),
- **point & link sampling** (`fill-sampled-points` / `fill-sampled-links`) — no
  phantom sampled points or links to a removed endpoint.

## Other fixes pulled in

- `rescaleInitialNodePositions` excludes `NaN` points from the bounding box — a single
  absent point used to collapse the whole layout (`Math.min(x, NaN) = NaN`). The
  degenerate single-point box is also handled (centered instead of `NaN`-scaled).
- `draw-curve-line.vert` skips a link with a `NaN` endpoint (would draw garbage
  geometry otherwise).

## Migration

Non-breaking and additive — no API signatures changed, and graphs without `NaN`
positions render and simulate identically. The only behavior change is that a `NaN`
position went from *undefined/broken* to *a defined "absent" feature*. `NaN` in a
size/color array still resolves to the config default for a **present** point; it
only means the exit default for an **absent** (NaN-position) one.

## Example

`src/stories/beginners/add-remove-points` (Storybook: **Examples / Beginners → Add &
Remove Points**) — a stable slot pool with `NaN` tombstones and a live data panel
(active vs. tombstoned slots). Buttons demonstrate the full enter/exit matrix (each
enter style mirroring an exit style), link add, and **Compact** (snapped renumber via
`render(undefined, 0)`).

## Out of scope (by design)

- **Slot lifecycle / compaction** is the caller's, and cosmos does **not**
  auto-compact — by design. Only the caller knows what indices are tied to (ids,
  links, selection), so the engine renumbering underneath them would break those.
  Callers reuse freed slots on add, or **Compact** when convenient.
- **Link-level absence tracking** — intentionally not added; callers drop a removed
  point's links, with the line shader as a safety net.
- **Position tracking** (`getTrackedPointPositionsMap`) — a raw read-back of the
  indices the caller asked for; caller-owned, left as-is. Drag is covered
  transitively (hover never returns an absent point).
