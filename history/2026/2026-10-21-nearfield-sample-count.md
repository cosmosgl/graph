<!-- suggested path: history/2026/2026-10-21-nearfield-sample-count.md -->

# Near-field sample count: measured from cell occupancy, fixed by `simulationRepulsionSamples`, peeled straight into two slot arrays

**Date:** 2026-10-21
**Commits:** `perf(force): peel near-field slots straight into their array layers — no copy per pass` (`8e4afa0`), `feat(force): choose the near-field sample count from measured cell occupancy — simulationRepulsionSamples fixes it` (`b0590a9`), `feat(stories): the steady-state motion check picks the near-field sample count` (`4d3811d`), `docs(force): the many-body docs describe the measured sample count and the two slot arrays` (`2caa709`)

## Why

Above 4,096 points the many-body force closes each point's 3×3 neighbourhood of finest
cells with a Monte-Carlo near field: every tick a depth peel lists K random occupants per
cell, and the force pass repels through those, weighted so the expectation equals the exact
sum (`2026-07-08-many-body-repulsion.md`). A cell with at most K points is exact; a fuller
one is a fresh noisy estimate every tick. Where gravity, links or the cluster force hold a
layout dense while alpha stays high, that noise never anneals and reads as per-point shimmer.

`2026-08-14-nearfield-jitter.md` set K by point count: 32 up to 16k points, 16 up to 65k, 8
above, tuned on one link-driven graph. The point count cannot see what the tiers were
standing in for. At the same count a clustered layout holds many times the points per
finest cell of a scattered one, and the grid now follows the data
(`2026-10-14-unbounded-space.md`), so the cell size depends on the layout's extent as well.
A layout of twelve held clusters at 12k points shimmered on the tiers' 32 where a scattered
layout of the same size was exact on 8.

A second cost sat in the peel itself. Pass k must sample pass k−1, and sampling one layer of
a texture while rendering to another layer of the same texture is a WebGL feedback loop, so
the peel ran on a pair of 2D targets and copied every pass into its layer of the one array
the force pass reads — a `copyTextureToTexture` per slot, each its own command encoder and
submit. At small point counts the passes themselves are nearly free, and a port of this
scheme measured the copies at about as much again as the passes (9.7 ms against 5.8 ms per
tick for 64 slots at 12k points, Apple M3, Chrome).

## What was decided

**K is the configuration when set, measured when not.** `simulationRepulsionSamples`, a
positive integer, fixes the count; a change applies on the next tick, which reallocates
the slot arrays, and anything that is not a positive integer throws a `RangeError` where
every config path meets (`applyConfig`). Unset, the count follows two measured quantities,
and the smaller wins:

- *What the layout wants.* Every 30 steps a one-pass reduction (`occupancy.frag`) turns
  the finest level's per-cell counts into 16² block sums, a fenced readback (the same
  `PickingReadback` the picking and centroid reads use) collects them on a later tick
  without waiting, and Σ count² / Σ count — the occupancy a typical point experiences, the
  mean cell count weighted by how many points live in each cell — rounded up to a power of
  two is the want. Cells that full are sampled exhaustively.
- *What the tick can afford.* Slots × points, the peel work per tick, stays under a budget
  of 1.6M point-samples, the point where the frame leaves vsync on a laptop GPU.

Both clamp to 8..64. The first measurement applies at once; a later change takes two
consecutive measurements that agree, so a layout settling at a boundary does not
reallocate every measurement. A new point set measures afresh, and a fixed setting skips
the measurement entirely. The measurement is a pass of about 0.1 ms every 30 ticks and a
4 KB readback.

**The slots live in two array textures, rendered into directly.** Slot k is layer k / 2 of
array k % 2; pass k renders into that layer through its own framebuffer and samples the
other array, so no pass reads the texture it writes. One depth attachment serves every pass,
since each clears it, and the 24-bit depth the peel hash needs is unchanged. The force pass
reads both arrays, choosing by the loop counter's low bit, with the same early break at the
first empty layer. Slot memory drops from three copies of each slot (two peel targets and
the array, plus a depth buffer per target) to one, plus one depth buffer. The sampling is
unchanged: with a fixed `randomSeed`, 12k clustered points stepped 40 times land on
bit-identical positions before and after.

**A running average over ticks was not taken.** Keeping a per-point average of the
near-field estimate across ticks would let a count several times smaller reach the same
stillness, and it is cheap. It also answers motion about three ticks late, which softens
repulsion against a sustained compression. The measured count already makes the dense
layouts seen so far exact, so the average stays a follow-up rather than a change to the
equilibrium.

## Example

**Performance → Steady-State Motion** (`src/stories/performance/steady-state-motion.ts`)
gained a *samples* picker: `auto`, 8, 16, 32 or 64, applied to every pane without a
restart. In the story's four layouts the finest cells hold at most a few points once
settled (4 in the clustered pane, fewer in the lattice and the blob), so every count from 8
up samples them exhaustively and the picker changes only what a tick costs: measured
headless, the clustered pane moves 0.0108 spacings per tick at 8 and 0.0107 at 64, and a
live switch down to 1 sample stays within the layout's own drift. The count shows on
layouts whose cells hold more than it — twelve discs of 12k points held by cluster force 1
and gravity 2 against repulsion 1 hold up to 9 per cell, and there 8 samples give 0.0097
against 0.0063 at 16 or more. No such pane is in the story yet. The choice heads the copied
results table.

```ts
// Fix the count; a change applies on the next tick.
graph.setConfigPartial({ simulationRepulsionSamples: 32 })
// Back to the measured count.
graph.setConfigPartial({ simulationRepulsionSamples: undefined })
```

## Verification

- `test/nearfield-sampling.test.ts`: the value is validated; a fixed count holds and
  follows a `setConfig` on the next tick; the automatic count starts at the floor of 8 and
  rises to 64 for twelve tight discs of 12k points once the first measurement lands. The
  two contract tests fail on the previous code by construction, where the key did not exist
  and the count came from the tiers.
- The peel change was checked against the previous code on the same seeded layout:
  positions after 40 steps are bit-identical. The 160 browser tests pass.
- `gen-diagrams.cjs` regenerates the pipeline, peeling and two-paths figures with the new
  wording.

## Still open

- No timing or stillness has been measured on this branch's own GPU yet; the copy cost
  above is from a port of the same scheme. The **Steady-State Motion** story is the place
  to take the readings.
- The port landed on top of the data-fitted grid (`2026-10-15-many-body-grid-seams.md`),
  whose finest cells are smaller than a space-anchored grid's at the same count, so the
  counts chosen here are lower than the same layouts would get on a grid over the space.
  The budget of 1.6M point-samples was set on a laptop GPU and has not been re-tuned since.
- The want rounds up from the point-weighted mean occupancy, and that undershoots at the
  one boundary that matters. On the twelve held discs above the mean is 6.6 while the
  fullest cells hold 9, so the automatic count stays at 8 where 16 is the cheapest exact
  count. The reduction already produces the maximum cell count per block; rounding up from
  it instead would give 16 there and still 8 on every layout in the story.
- The want rounds up to a power of two, coarser than the count now needs to be.
- The running average, or slots dealt round-robin from a fixed per-point rank so
  consecutive ticks sample without replacement, would bring the same stillness from a
  smaller count.
