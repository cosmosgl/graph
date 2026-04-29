<!-- suggested path: history/2026/2026-04-22-gpu-transitions.md -->

# GPU transitions for positions and attributes

**Commits:** c5fd30e, 75b1a15, 74e0567, b775c4c, 45a12f4, 579801d, 5006eea, fed8dcd, 6256b66, cd32f59

## Why

We wanted Cosmos to:

- Smoothly animate point positions, colors, and sizes (and link colors and widths) from one state to another, instead of snapping.
- Switch the simulation on and off at runtime, and actually free its GPU resources when it's off so apps that don't need layout don't pay for it.

## Transitions

New module `src/modules/Transition/` — a single state machine that tracks every animated property (positions, point colors/sizes, link colors/widths) in one shared cycle.

New config:

```ts
transitionDuration: 800,               // ms; 0 or less = no animation
transitionEasing: TransitionEasing.CubicInOut,
onTransitionStart?: () => void
onTransition?:      (progress: number) => void
onTransitionEnd?:   (interrupted: boolean) => void
```

**First render after init.** Position setters never animate — there's no prior state to interpolate from. The auto-pause rule is also skipped. Attribute setters fire transition callbacks, but since there's no prior attribute data either, source equals target and the result is a visual snap.

**Auto-pause (position transitions only).** When `render()` sees a pending **position** transition with `transitionDuration > 0` and a running simulation (and it's not the first render), the simulation pauses before the transition starts and `onSimulationPause` fires. The simulation **stays paused after the transition ends** — `setPointPositions()` signals the user wants to explore a specific layout, not have forces immediately pull nodes away from it. Call `unpause()` to resume explicitly. Color and size transitions don't compete with force updates and never pause the simulation.

**Hover and drag during transitions.** Hover detection is skipped only during point size transitions — point hover picking reads target point sizes rather than interpolated sizes, so hit-testing would otherwise mismatch the geometry currently on screen. Position and link hover continue to use the interpolated current positions. Drag start is blocked during point position **and** point size transitions: starting a drag mid-position-transition would mean grabbing a point whose on-screen location is still moving under the cursor, and mid-size-transition the hit area would mismatch the visible point.

**Cache invalidation.** Position and centroid caches are invalidated each frame during a position transition so `getTrackedPointPositionsMap()` / `getTrackedPointPositionsArray()` and centroid getters return the interpolated values, not stale post-transition targets — important when the simulation is paused and there's no other refresh driving cache turnover.

**`fitView` during transition.** `fitView()` and `fitViewByPointIndices()` frame the target positions (`graph.pointPositions`), not the interpolated positions currently on screen.

## Simulation toggle

`enableSimulation` is now runtime-switchable via `setConfig` or `setConfigPartial` (it's **not** in `preserveInitOnlyFields`):

```ts
graph.setConfigPartial({ enableSimulation: true })
graph.setConfigPartial({ enableSimulation: false })
```

- `false → true`: creates simulation modules and GPU resources, fires `onSimulationStart`. If a transition is mid-flight, it's interrupted first (`onTransitionEnd(true)`) and the simulation starts from the current mid-animation positions. Any **queued but not yet started** position transition is also dropped, so the next `render()` doesn't immediately auto-pause the simulation it just enabled.
- `true → false`: stops the simulation, destroys simulation-only modules and GPU resources, fires `onSimulationEnd`. Any active transition keeps playing — its state is untouched.

`start()` and `unpause()` only interrupt a transition when **positions** are animating; an active color/size cycle keeps running. Repeated `start(alpha)` calls now reheat the simulation by resetting `alpha` and `simulationProgress`, but `onSimulationStart` only fires on a stopped/paused → running transition, not on every reheat.

## Behavior matrix

All rows assume a setter ran (e.g. `setPointPositions`) so a transition is **pending** when `render()` fires. `enableSimulation` = simulation on/off, `transitionDuration` = transition duration. Rows describe the **second and later** renders — on the first render, position setters always snap (see "First render after init" above).

### Initial state at `render()`

Each row is the state when `render()` fires. The last two columns show what happens if you flip each config via `setConfigPartial` from that state. Auto-pause applies to **position** transitions only — color/size transitions never pause the simulation.

| `enableSimulation` + `transitionDuration` | Behavior | `enableSimulation` switch | `transitionDuration` switch |
|---|---|---|---|
| `false` + `≤0` (no simulation, no transition) | Snap. No simulation, no transition cycle. | `→ true`: starts simulation, creates modules and resources, fires `onSimulationStart`. | `→ >0`: next animation uses the new duration. |
| `false` + `>0` (no simulation, transition) | Animate. No simulation to pause. | `→ true`: interrupts the transition (`onTransitionEnd(true)`), then starts simulation from current positions, fires `onSimulationStart`. | `→ ≤0`: the next update + render cycle snaps immediately instead of animating. If a transition is already running, the next render frame interrupts it with `onTransitionEnd(true)`. |
| `true` + `≤0` (simulation, no transition) | Snap. Simulation keeps running. | `→ false`: stops simulation, destroys simulation-only resources, fires `onSimulationEnd`. | `→ >0`: next animation uses the new duration. |
| `true` + `>0` (simulation, **position** transition) | Animate. **Simulation auto-pauses and stays paused after** the transition ends; `onSimulationPause` fires. Call `unpause()` to resume. | `→ false`: stops simulation, destroys simulation-only resources, fires `onSimulationEnd`. | `→ ≤0`: the next update + render cycle snaps immediately instead of animating. `start()` only changes simulation state. If a transition is already running, the next render frame interrupts it with `onTransitionEnd(true)`; `onSimulationEnd` still only fires if the simulation is later stopped or finishes. |
| `true` + `>0` (simulation, **color/size** transition) | Animate. Simulation keeps running — color/size transitions don't compete with forces. | `→ false`: stops simulation, destroys simulation-only resources, fires `onSimulationEnd`. | `→ ≤0`: the next update + render cycle snaps immediately instead of animating. `start()` only changes simulation state. If a transition is already running, the next render frame interrupts it with `onTransitionEnd(true)`; `onSimulationEnd` still only fires if the simulation is later stopped or finishes. |

## Migration

The new `transitionDuration` config defaults to `800` ms, so calling `setPointPositions(...); render()` after the first render will now animate instead of snap — and if the simulation is running, it will auto-pause for the duration of the animation **and stay paused afterwards**. Call `graph.unpause()` to resume forces.

To keep the old snap behavior, set `transitionDuration: 0` in your config:

```ts
new Graph(el, { transitionDuration: 0, ... })
```

Or disable it only for specific programmatic updates:

```ts
graph.setConfigPartial({ transitionDuration: 0 })
graph.setPointPositions(newPositions)
graph.render()
graph.setConfigPartial({ transitionDuration: 800 }) // restore if needed
```

## Example

`src/stories/transition/` (Storybook: **Examples / Transitions → Point Transition**) — a 200k-point cloud sampled from Bryullov's *Horsewoman* (1832) that auto-loops between the picture layout and a sequence of tile scatters. Demonstrates `transitionDuration`, `TransitionEasing`, and the `onTransitionStart` / `onTransition` / `onTransitionEnd` callbacks in a self-contained, runnable setup.

## Future work

- **Separate timelines per property.** One clock runs all animations today, so a new one cuts the previous off. Goal: independent timelines per property (or per setter call).
- **Mid-animation attribute updates.** Point and link attribute transitions reuse their source/target buffers when topology stays the same, but smoothing updates that arrive in the middle of an already-running attribute transition is still a known edge case.
