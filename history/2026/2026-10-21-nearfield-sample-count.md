<!-- suggested path: history/2026/2026-10-21-nearfield-sample-count.md -->

# Near-field sample count: measured from cell occupancy, fixed by `simulationRepulsionSamples`, peeled straight into two slot arrays

**Date:** 2026-10-21
**Commits:** `perf(force): peel near-field slots straight into their array layers — no copy per pass` (`3700475`), `feat(force): the near-field sample count is measured from cell occupancy in Graph's render loop, or fixed by simulationRepulsionSamples` (`efeca24`), `docs(force): the many-body and collision docs describe the measured sample count, the two slot arrays and their budgets` (`374666e`), `feat(stories): the steady-state motion check picks the near-field sample count — twelve held discs show where it matters` (`c378f49`), `feat(stories): the sample count under load — a hyperbolic graph with its frame times` (`d5b0486`)

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
At 12k points a scattered layout is exact on 8 samples where the tiers ran 32, four times
the passes, and twelve discs packed to about 40 points a cell shimmer even on 32.

A second cost sat in the peel itself. Pass k must sample pass k−1, and sampling one layer of
a texture while rendering to another layer of the same texture is a WebGL feedback loop, so
the peel ran on a pair of 2D targets and copied every pass into its layer of the one array
the force pass reads — a `copyTextureToTexture` per slot, each its own command encoder and
submit. On this branch's own GPU (Apple M3, Chrome on Metal) the copies were a quarter of
the step: at the same count, `main` against the branch, 3.65 → 2.74 ms per step with 16
slots on 22,500 clustered points and 9.02 → 6.72 ms with 8 slots on a 100,000-point blob,
measured as 120 steps between synchronous readbacks. A port of this scheme had measured
the copies at about as much again as the passes at 12k points and 64 slots.

## What was decided

**K is the configuration when set, measured when not.** `simulationRepulsionSamples`, an
integer from 2 to 64, fixes the count; a change applies on the next tick, which
reallocates the slot arrays, and anything else throws a `RangeError` from the call that
passed it (`validateConfig`). `config` is a public field, so the force checks the value
again where it reads it: one written there directly counts only if valid, and anything else
falls back to the automatic count rather than reaching an allocation, without the restart
of the measurement a setter does. The ceiling is the measured count's too, and a cost cap: at
64 a slot array holds 32 layers, within the 256 every WebGL 2 device guarantees, so a
configured count can always be allocated. Past the device's layer limit the arrays could
not be allocated and their framebuffers came out incomplete — an error with luma's debug
checks on, a near field of undefined slots without them. Unset, the count follows two
measured quantities, and the smaller wins:

- *What the layout wants.* Every 30 steps, less often on a busy GPU (below), a one-pass
  reduction (`occupancy.frag`) turns
  the finest level's per-cell counts into 16² block sums, and a fenced readback (the same
  `PickingReadback` the picking and centroid reads use) brings them back the way the other
  non-blocking reads come back: the copy is issued at the end of a frame and collected at
  the start of the next, before any pass is queued, with the frame held until the copy
  lands, since `getBufferSubData` waits for every command queued before it. Only that
  loop measures, and only on a device the graph created. A host that drives the steps or
  frames itself (the deck.gl layer, a headless graph's `step()`, `renderOneFrame()` with
  the loop off, a bare `GraphSimulation`, a graph given its device, whether or not the host
  also draws to it, since the graph cannot tell)
  keeps submitting work behind the copy, and the collect waits for all of it: on a
  GPU-bound deck.gl loop each reading stalled about three frames (see Verification). Such
  a host takes no reading and keeps the size tier below, or the count its loop last
  measured. Any step or frame outside a held one drops a reading in flight, which a later
  frame would collect behind that work: a manual `step()` between the loop's frames, or
  the host's first `renderOneFrame()` after the loop is turned off; a `step()` between
  every pair of frames therefore keeps the count where it is. The only work a held frame's
  collect can still find ahead of it is the uploads of a data apply made between frames,
  which keeps the reading in flight. The reduction sums, per block, the points and the
  points in cells fuller than 8, 16 and 32, and the want is the smallest of 8, 16, 32 and
  64 that leaves at most 1 % of the points in cells fuller than it: those are sampled
  rather than listed, and their force jitters from tick to tick. The want was first the
  occupancy a typical point experiences, Σ count² / Σ count, rounded up, and a dense
  minority did not move it: on a 50k-point hyperbolic graph the typical point's cell holds
  about four, so the count was 8, while 5 % of the points sat in a core of 9 to 17 a cell
  that jitters at 8 and stands still at 16; the twelve held discs of the Example (mean 6.6,
  fullest 9) stayed at 8 where 16 is exact. Rounding up from the fullest cell instead
  would let one stray cell set the count for every point.
- *What the size can afford.* Slots × points, the peel work per tick, is held under a budget
  of 1.6M point-samples, the point where the frame leaves vsync on a laptop GPU, and the
  slot layers at the finest grid stay under 32 MiB of `rg32float` texels: 16 at the 512²
  grid, up to 64 on a smaller one. The time budget alone allowed 64 at the 512² grid from
  16,385 to 25,000 points: about 128 MiB of slot arrays, where the tier's 16 take 32 MiB.

Both clamp to 8..64, so they limit how high the count goes, not the work below the floor:
past 200,000 points 8 samples spend more than the 1.6M budget, as the size tiers' 8 did, and
a lower floor would not change that for long (2 samples pass it at 800,000 points) while
it made the largest graphs shimmer. Until the first measurement lands, and wherever none is taken, the
count is the point count's size tier, the 32 / 16 / 8 the collision force still uses, so a
host without a reading runs what the force ran before the count was measured, not the
floor; a reading itself may still pick fewer, down to 8, where the cells hold few points.
Starting from the floor of 8 instead, a host stepping in one synchronous loop ran 8 where
the tiers ran 32: a fence
signals only between tasks (Blink refreshes a sync's status at most once per task), so no
reading lands inside such a loop. The first measurement applies at once; a
later change takes two consecutive measurements that agree, so a layout settling at a
boundary does not reallocate every measurement. The measurements come every 30 steps,
counted from the last reduction drawn, so one put off by a copy still in flight runs on the
next step that can. Steps alone do not bound the cost: the held frame waits for the GPU to
drain everything queued ahead of the copy, several frames on a GPU-loaded loop, and a slow
loop runs few steps a second (at 50k points on the hyperbolic graph below, freezes came at
about 0, 1, 3, 7, 15 and 31 s). So `Graph` measures each hold and hands it to the collect,
and the next measurement also waits a hundred times that hold, however few steps that is:
the holds take about 1 % of the time on any GPU. A hold is charged when an occupancy copy
was in flight: the whole hold, also when a pick, tracked positions or centroids were pending
too, which errs towards measuring less often, and nothing when only other copies held the
frame, so an overlay reading tracked positions every frame cannot keep the count from being
measured. The loop measures a hold from the first frame it holds back, so it is shorter than
the freeze the user sees. A hold the cap ends, a copy that never lands, is charged the same, or a fence that
never signals would freeze a frame for a second every 30 steps. A restart keeps the wait,
so a new point count or a toggled key on a loaded GPU waits like any other measurement.
A richer schedule was tried in review and dropped: a back-off that doubled the interval
while readings agreed, triggers that brought it forward on force changes and new links, a
flag for readings in flight across such a change, and charging only the part of a hold the
occupancy copy had alone. The budget alone already spaces the readings wherever they cost
anything, a reading every 30 steps is free where the GPU keeps up, and each of those rules
needed another to undo it. A changed point count measures afresh (a
new dataset of the same count keeps the measurement as it runs, so streamed positions are
measured at all), and a fixed setting skips the measurement entirely. A change of the key,
either way, restarts the measurement where the key is set and cancels a reading in flight,
so unsetting it measures afresh from the tier rather than reusing a reading of a layout
that may have moved while the count was fixed, even with no step in between. Above 100,000 points the time budget, rounded down to a power of two, pins the
count at 8 and nothing is measured,
and a reading without a finite occupancy is ignored. The measurement itself is a pass of
about 0.1 ms and a 4 KB readback; its cost is the hold: nothing at vsync, and on a
GPU-loaded loop a wait for the queue to drain, 40–85 ms at 400k links and 207–251 ms at
1.5M on the M3 (see Verification), capped at 1 % of the time by the wait above.

**The slots live in two array textures, rendered into directly.** Slot k is layer k / 2 of
array k % 2; pass k renders into that layer through its own framebuffer and samples the
other array, so no pass reads the texture it writes. One depth attachment serves every pass,
since each clears it, and the 24-bit depth the peel hash needs is unchanged. The force pass
reads both arrays, choosing by the loop counter's low bit, with the same early break at the
first empty layer. Slot memory drops from K + 2 layers and two depth buffers (the array plus
the two peel targets, each with its own depth) to K layers (⌈K/2⌉ per array, so K + 1 for
an odd configured K) and one depth buffer. The sampling is
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
restart, and a pane for it in place of the 10,000-point lattice, which measured the same
under every setting. In the 25 clusters and the blob (the 163-point pane runs all pairs,
where the key has no effect) the finest cells hold at most a few points once settled (4 in
the clustered pane, fewer in the blob), so
every count from 8 up samples them exhaustively and the picker changes only what a tick
costs: measured headless, the clustered pane moves 0.0108 spacings per tick at 8 and 0.0107
at 64, and a live switch down to a single sample (allowed at the time; the minimum is 2
now, since a single slot can hold the point itself and bias the estimate low) stayed within
the layout's own drift. The count shows on layouts whose cells hold more than it, and the
new pane is one — twelve discs of 12k points held by cluster force 1
and gravity 2 against repulsion 1 hold up to 9 per cell, and there 8 samples give 0.0097
against 0.0063 at 16 or more.

**Performance → Sample Count Under Load** (`src/stories/performance/sample-count-under-load.ts`)
runs the Hyperbolic story's graph at 25k, 50k or 100k points with alpha held at 1, a
*samples* switch, and a panel of the count in force and what `auto` wanted, step median,
p99 and maximum, long steps and steps a second over the last five seconds, and a strip
of the last 300 steps with the long steps in red. It times simulation steps, one a frame
while the simulation runs, so a held frame is a long step; a zoom pauses the simulation
and is not measured. Zoomed into the 50k core, points jitter at 8 and stand still at
16; `auto` picks 8 at 25k and 16 at 50k and 100k. Counts above what the cells hold change
only the cost, and the readings of `auto` show as red bars the hold budget spaces out.

```ts
// Fix the count; a change applies on the next tick.
graph.setConfigPartial({ simulationRepulsionSamples: 32 })
// Back to the measured count.
graph.setConfigPartial({ simulationRepulsionSamples: undefined })
```

## Verification

- `test/nearfield-sampling.test.ts`, on 4,500 points unless the size is the point (the
  size tier and what the size affords are the same as at 12k, and a step costs half on the
  software renderer CI runs, where the file's 12k graphs had starved the test files run
  beside it): the value is validated; a fixed count holds and
  follows a `setConfig` on the next tick; the automatic count starts at the size tier (32)
  and rises to 64 for twelve tight discs once the first
  measurement lands; a
  value is rejected where it is passed, before the device is ready; the measured count
  survives a data apply of the same point count and starts over for another. All of them
  fail on the previous code by construction, where the key did not exist and the count came
  from the tiers.
- Added with the size tier, the memory cap and the render-loop-only rule, each failing on
  the code before its fix. The measurement tests run on a `Graph` with its render loop: it
  starts at the tier; a 20,000-point layout that measures above 16 runs 16; 100,000 points
  take a reading and 100,001 do not; a first reading replaced by NaN as it lands leaves the
  count unset (the code before applied NaN); setting and unsetting the key on a paused
  graph after a reading of 64 drops that reading (the code before kept it), and setting it
  while a copy is in flight cancels the copy; a `step()` right after the frame that issued
  a copy drops it, and so does the host's first `renderOneFrame()` after the loop is turned
  off with a copy in flight (the code before collected it, 64). A bare simulation and a
  headless graph stepped 100 times with a task boundary between steps, a graph with its
  loop off drawn 100 times by `renderOneFrame()`, and a graph whose loop runs on a device
  the test created read nothing back and run the tier; on the code before, the bare
  simulation measured 64, the `renderOneFrame()` host took a reading of the discs once they
  had spread (8), and the shared-device graph measured 64. The point-count apply test
  checks the slots of the first step after the apply, and the 100,001-point test waits for
  a step before asserting that no reading was taken.
- The deck.gl stall, measured before the render-loop-only rule on the M3 (Chrome on Metal):
  a `CosmosGraphLayer` with 50k clustered points, 10 s per run, two rounds, the automatic
  count against a fixed 16 (which takes no readings):

  | deck loop | frame p50 | frame max, auto / fixed | one occupancy collect |
  |---|---|---|---|
  | at vsync, no links | 16.7 ms | 17.8 / 17.7 ms | 0.4–0.9 ms, max 1.9 |
  | 400k links, GPU-bound | 66 ms | 216 / 84 ms | ~180 ms |
  | 1.5M links, GPU-bound | 200 ms | 616 / 333 ms | ~605 ms |
- The schedule: a test serves fixed readings and pins a measurement every 30 steps, the
  first reading applied at once and a change applied after two that agree. The hold the
  budget answers, measured in `Graph`'s own render loop on the M3 (Chrome on Metal), with a
  reading every 30 steps and nothing spacing them: 50k points in twelve tight clusters,
  where the automatic count picked 8, so auto against a fixed 8 runs the same passes and
  differs only by the readings; 10 s per run, two rounds:

  | Graph loop | frame p50 | frame max, auto / fixed 8 | holds per 10 s | one hold |
  |---|---|---|---|---|
  | no links | 16.7 ms | 19.1 / 18.8 ms | 3–5 | ~5 ms |
  | 400k links | 17–17.6 ms | 57–98 / 21–22 ms | 18–19 | 40–85 ms |
  | 1.5M links | 49–54 ms | 247–286 / 54–56 ms | 6–7 | 207–251 ms |

  The collect itself stays under 0.6 ms.
- The coverage rule: a test checks it on fixed sums (5 % of the points in cells of more
  than 8 and none above 16 wants 16; exactly 1 % over 8 keeps 8), and a running graph
  whose 5 % core sits on a lattice of 9 to 16 points a cell wants 16 on its first reading,
  where the code before read 8. In `Graph`'s loop on the M3, `auto` picks 8 on the 25k
  hyperbolic graph and 16 at 50k and 100k (the reading wants 32 at 100k; the size caps
  it), and 16 on the twelve held discs, held over 45 s. Judged by eye, zoomed into the 50k
  core in the story: points jitter at 8 and stand still at 16.
- The hold budget: a test reports every reading as a 300 ms hold. No second copy is issued
  in the next 3 s, where the code before issued three, nor in the 2 s after a key change,
  since a restart keeps the wait. With fences that never signal, the first occupancy copy
  holds the frame to the cap, and the next measurement waits a hundred times that second.
  A frame held for another copy alone leaves the wait as it was; it delayed the next
  measurement by the hold's hundredfold while every hold was charged.
  Writing 1000 to `graph.config` directly runs the automatic count, where the code before
  allocated 1000 slots. In the story on the M3, with `auto` over the first minute after
  loading: no reading freezes at 25k, where the GPU keeps up; at 50k freezes of 172–187 ms
  at 2.4, 6.9, 21.7, 36.1 and 51.4 s; at 100k 312–339 ms at 2.8, 6.8, 32.7 and 59.3 s,
  after the load's own first frame of about 470 ms.
- The peel: a test lays out 900 groups of 5 points so that no cell holds more than 5, and
  at 5 and at 6 samples one step lists every point exactly once across the slot layers. A
  previous layer off by one, or a pass peeling from the array it writes, fails it. A second
  test checks the force pass reads both arrays: 2,250 isolated pairs at 2 samples, slot 1
  in the odd array, and each pair's centre moves with its neighbours' along the pair's axis
  (a residual of about 5e-5 of the opening; about 1 with the odd array bound to the even
  one, where one point of each pair does not see the other). The peel
  was also checked against the previous code by hand on a seeded layout: positions after
  40 steps are bit-identical. The browser suite passes.
- `gen-diagrams.cjs` regenerates the pipeline, peeling and two-paths figures with the new
  wording.

## Still open

- Judged by eye on this branch's own GPU (Apple M3) in the **Steady-State Motion** story:
  on the held discs the traced point's trail is a small tangle at 8 samples and a dot from
  16 up, and the other four panes look the same at every count. `auto` picked 8 there
  under the mean rule, where 16 is still; the coverage rule picks 16.
  Timing (Chrome on Metal, ms per step, 120 steps between synchronous readbacks). The
  harness stepped a paused graph with `step()`, which the code then measured in; such a
  host now runs the tier (16 / 8), so the auto row records that code's choice:

  | samples | 22,500 clustered | 100,000 blob |
  |---|---|---|
  | `main` (tiers: 16 / 8) | 3.65 | 9.02 |
  | auto (picked 8 / 8) | 2.28 | 6.74 |
  | 8 | 2.28 | 6.72 |
  | 16 | 2.74 | 7.33 |
  | 32 | 4.03 | 8.47 |
  | 64 | 6.51 | 10.71 |

- The port landed on top of the data-fitted grid (`2026-10-15-many-body-grid-seams.md`),
  whose finest cells are smaller than a space-anchored grid's at the same count, so the
  counts chosen here are lower than the same layouts would get on a grid over the space.
  The budget of 1.6M point-samples was set on a laptop GPU and has not been re-tuned since;
  on the M3 the cost of a slot is nearly flat with the point count — about 0.07 ms a pass
  from 22,500 to 100,000 points — so the budget is conservative there: it allows 16 slots
  at 100,000 points, where 64 step in 10.7 ms.
- The 1 % the automatic count may leave sampled was set by eye on the hyperbolic graph and
  the held discs, not tuned.
- Each reading on a GPU-bound loop still freezes the picture for as long as the queue takes
  to drain, 185 ms at 50k points and 315–360 ms at 100k in the story; the budget only spaces
  the freezes. Two refinements could space them further where nothing changes: reading the
  next one from how close the last was to flipping the count (the overflow shares against
  1 %, and their trend), or measuring at once after a change that moves the density (a
  force setting, new links, a reheat, a drag), which would make longer waits safe.
- The want rounds up to a power of two, coarser than the count now needs to be.
- The running average, or slots dealt round-robin from a fixed per-point rank so
  consecutive ticks sample without replacement, would bring the same stillness from a
  smaller count.
