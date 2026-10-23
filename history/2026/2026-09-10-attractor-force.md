<!-- suggested path: history/2026/2026-09-10-attractor-force.md -->
# Attractor force

**Date:** 2026-09-10
**Commits:** `feat(force): add the attractor force — a per-point soft position constraint`, `fix(force): validate attractors and preserve pending targets` ([#270](https://github.com/cosmosgl/graph/pull/270))

## Why

Users wanted a way to *constrain* individual points without freezing them. The existing
tools were all-or-nothing: `setPinnedPoints` fixes a point in place and removes it from the
layout; the cluster force pulls a whole group toward one shared position (a cluster centre or
centroid). Neither covers "this point should live *around here*, but links and repulsion may
still move it" — the per-point anchor that d3's `forceX`/`forceY` provide, e.g. for keeping a
node near a known geographic or semantic position while the rest of the layout stays organic.

The attractor force adds that: every point may carry its own target position and its
own strength, and the pull is just one more term in the velocity sum, so it composes with
links, repulsion, gravity, clusters and collision rather than overriding them.

## API

Two data methods on `Graph` (`src/index.ts`) and one config key:

```ts
// One [x, y] pair per point, in simulation space. A non-finite coordinate = no attractor.
graph.setPointAttractors(new Float32Array([100, 100, NaN, NaN, 300, 250]))

// One coefficient per point (default 1). Non-finite entries fall back to 1.
graph.setPointAttractorStrength(new Float32Array([1, 0.4, 0.3]))

// Global coefficient (default 0.1), same scale as simulationCluster.
graph.setConfigPartial({ simulationAttraction: 0.3 })
```

Both arrays follow the engine's channel contract: they must match the point count exactly
(pairs for positions), otherwise the channel is treated as unset — a length mismatch never
reads another point's data. An unset position array means no attractors, so the force does
nothing; an unset strength array only drops the per-point coefficients, and every point
pulls with `1`. Neither array is edited; `NaN` is
resolved at upload time into a per-point "has target" flag. Non-finite target coordinates
are treated as no target, and non-finite strengths fall back to `1`. An array
with no finite targets skips the force pass entirely.

## How it runs

`src/modules/ForceAttractor/` is a `CoreModule` in the shape of `ForceGravity`, plus one
data texture like the cluster force's coefficient texture:

- `create()` packs one `rgba32float` texel per point — `(targetX, targetY, strength,
  hasTarget)` — from `GraphData.pointAttractors` / `pointAttractorStrength`
  (`updateAttractors()` in `src/modules/GraphData/index.ts`). The texture is only reallocated
  when `pointsTextureSize` changes; otherwise the data is re-uploaded in place.
- `force-attractor.frag` is a full-screen pass over the points texture. For a point with
  `hasTarget = 1` it writes `alpha * dist * simulationAttraction * strength` along the
  direction to the target — the same linear spring the cluster force uses, so the two
  coefficients are directly comparable. `hasTarget = 0` (and NaN positions, via `dist > 0`)
  write zero velocity.
- In `runSimulationStep` it runs right after the cluster force and before collision, with
  the usual `swapFbo → run → updatePosition` triple: it is one of the attractor forces, and
  collision has to see its overlap in the same tick (see the collision entry).

Resource lifecycle follows the other simulation-only forces: constructed only when
`enableSimulation` is on, rebuilt by `ensureSimulationModules`, torn down by
`destroySimulationModules`, and `create()` re-runs on `setPointPositions` (the index space
changed) or either attractor setter (`isForceAttractorUpdateNeeded`). `run()` is gated on
`isActive` — a valid attractor array with at least one finite target — so a graph that never
sets one pays the compiled program, like the gravity force, and nothing per step.

## Example

`src/stories/forces/attractors.ts`, *Examples/Forces/Attractors*. 400 points chained by links
start in a pile at the centre; their attractors are sampled along a parametric curve (heart,
spiral, rose, Lissajous, star, lemniscate), so the attractor force draws the shape and the
links trace it as a coloured ribbon. Every fifth point has no attractor and, with gravity off, settles
midway between its neighbours on the chain alone — the visible proof that the constraint is
soft; with gravity on it sags toward the centre. Gravity
toward the centre is the competing force: at the default loose strength (0.15) the figure
settles shrunken, at firm strength (1) the attractors win and it expands to full size. Buttons
cycle the shape (re-sending links and attractors), flip the strength, and toggle gravity;
right-click repulsion is on so the curve can be poked and watched recovering. The shape and
strength handlers call `render()` to apply the data and then `start(1)`, because `render()`
never restarts a settled simulation; the gravity toggle is a config change, so it only reheats.

## Docs

`simulationAttraction` in the Configuration table; `setPointAttractors` and
`setPointAttractorStrength` in the API reference, after the cluster methods.
