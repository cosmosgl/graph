<!-- suggested path: history/2026/2026-10-07-collision-constraint.md -->

# Collision as a constraint: pairwise contacts at every size, no alpha, radius-aware springs, iterations

**Commits:** `feat(force): collision is a constraint — unscaled by alpha, integrated without friction` (`fcd1137`), `feat(force): link rest lengths floor at the contact distance while collision is on` (`b56261c`), `feat(force): simulationCollisionIterations — collision passes per tick` (`5c14446`), `feat(force): exact all-pairs collision at or below 4,096 points` (`8839b63`), `feat(force): depth-peeled neighbour slots replace the cell-average grid above 4,096 points` (`0ce67c7`), `feat(stories): collision vs hub springs — seven hubs re-piling their leaves against collision` (`c6b9a31`); docs: `docs(force): the collision design doc for the constraint-style, pairwise force` (this entry's own commit)

## Why

With collision on, a dense cluster whose links pull inward never resolved: the leaves of a
hub sat inside each other for as long as the simulation ran. Four things in the collision
force conspired, and only the first two were tuning:

- **The push cooled with alpha.** Like every other force it was scaled by `alpha`, which
  decays exponentially — roughly the last two thirds of a simulation's ticks run below a
  tenth of full strength. Whatever overlap the springs introduced while hot froze in.
- **The springs demanded overlap.** A link rest length shorter than the two collision radii
  pulls the pair into overlap every tick, and the two forces settle wherever they balance: a
  guaranteed partial overlap, by construction.
- **One bounded pass per tick** could not keep up with a hundred springs re-piling a hub.
- **The cell-average contact model stalls in a pile.** The grid path pushes a point away
  from each neighbouring cell's *mean*; a point gets no push unless it overlaps a mean, so
  pairs can sit inside each other while every mean is out of range, and two near-coincident
  points see the same field and never part. Measured on the new hub story with every other
  force off: 1,836 overlapping pairs after 2,000 ticks, the same after 10,000. Stuck, not slow.

`d3-force`'s `forceCollide` sidesteps all four: it ignores alpha, resolves exact pairs, and
takes an `iterations` count; the app is expected to set `linkDistance` to clear the radii.

## What changed

**Collision is a constraint, not a force.**
- `force-collision-spatial.frag` and the new all-pairs shader apply `simulationCollision`
  straight, with no `alpha` factor. The per-pass cap, which bound the push at the first tick
  anyway, is what keeps full strength stable at every alpha.
- `Points.updatePosition(friction)` takes the friction per call; the collision loop in
  `runSimulationStep()` passes `1`, so the bounded correction lands in full.

**Springs agree with it.** While `simulationCollision > 0`, the link shader floors each
spring's rest length at `R_self + R_other` (fixed or size-derived radius, plus padding), read
from the collision force's resolved-size texture. The tick now builds the collision resources
ahead of the forces so that texture exists for the link passes. `simulationLinkDistance`
below the contact distance means "as close as contact allows".

**`simulationCollisionCooling`** (default `0`) is the way back: it multiplies the correction
by `alpha^cooling`, so `1` fades collision with the other forces, for layouts that stay under
compression and would otherwise jitter until the simulation ends; `0` keeps the constraint.

**`simulationCollisionIterations`** (default `1`) repeats the grid-build-or-all-pairs pass
plus integration that many times per tick on the freshest positions. Linear cost per pass;
dense hubs resolve noticeably better at 2–4.

**Pairwise contacts at every size.** Both paths resolve an overlapping pair `d3`-style —
projected to contact along the line of centers, split by `r²` so the smaller disc yields —
then scale by `simulationCollision` (1 = full projection; up to 2 over-relaxes) and cap the
per-pass step at one own radius so a seeded pile inflates instead of exploding. Coincident
points fan out along a per-point golden-angle direction.
- At or below 4,096 points (`ALL_PAIRS_MAX_POINTS`, the many-body force's threshold)
  `force-collision-allpairs.frag` tests every pair in one pass.
- Above it, `force-collision-slots.frag` tests every pair within reach. The cell-average grid
  is gone: the grid cell still spans the contact range (so the 3×3 scan is exhaustive) and is
  now also bounded by the many-body force's finest grid for the point count, and each cell's
  occupants are listed by the many-body force's depth-peeling shader
  (`build-nearfield-slots.vert`, reused as is) into K slots — 32 up to 16k points, 16 up to
  65k, 8 above, the tiers now shared from `src/modules/Shared/cell-slots.ts`. A cell with at
  most K points is resolved exactly; a denser cell shows each point a fresh random K of its
  neighbours per pass. The four offset grids, the build-grid shaders and the cell-average
  shader are deleted, with the design doc's figures of them.

## Measured during development (hub story data, 628–710 points, an earlier story configuration: strength 1, 2 iterations, gravity 0.1)

| Condition | Overlapping pairs | Deep (> 10 %) |
|---|---|---|
| seeded, tick 0 | 10,141 | 8,633 |
| grid path, every other force off, tick 10,000 | 1,836 | 1,513 |
| exact path, every other force off, tick 200 | 111 (all touching, < 0.1 %) | 0 |
| exact path, every other force off, strength 2, tick 50 | 0 | 0 |
| exact path, story springs, alpha ≈ 0.25 (tick 1,000) | 2,156 | 1,598 |
| exact path, story springs, alpha ≈ 0.004 (tick 4,000) | 1,010 (mean 3 % penetration) | 60 |
| exact path, springs faded to 0 (decay 1,500, tick 3,000) | 112 (touching) | 0 |

Above the threshold, 100-point piles seeded in a 20-unit disc (sizes 6–16, padding 1,
4,096-unit space, every other force off, two iterations), overlapping pairs within the piles:

| Points | Path | Seeded | Tick 100 (deep > 10 %) | Tick 300 |
|---|---|---|---|---|
| 4,000 | exact | 61,071 | 3,202 (0) | 101, all touching |
| 4,100 | slots, K = 32, 227² grid | 62,610 | 3,272 (0) | 114, all touching |
| 5,000 | slots, K = 32 | 76,389 | 4,099 (0) | 140, all touching |
| 50,000 | slots, K = 16 | 767,433 | 39,758 (0) | 3,404 at tick 200, all touching |

## Cost

Measured end to end on an Apple M3 Max (Chrome, ANGLE Metal), as the per-tick difference
against the same graph with collision off, one iteration: 0.42 ms at 1,000 points and
2.66 ms at 4,000 (all-pairs); 2.44 ms at 5,000 and 2.98 ms at 16,000 (32 slots); 0.70 ms at
50,000 (16 slots); 0.65 ms at 100,000 and 1.17 ms at 200,000 (8 slots). The cell-average grid
it replaced cost 0.09–0.34 ms up to 16,000 points and 0.45–1.40 ms above. So the rework
costs 2.4–3 ms per tick per iteration from 4,000 to 16,000 points (0.42 ms at 1,000), and
nothing extra from 100,000 up. At 50,000 the first pass costs 0.70 ms but each further pass
about 1.5 ms. The slot path's cost is dominated by the slot count, because every peeled slot
is a render pass. The full tables are in the design doc and the PR.

Timer queries were tried first and abandoned: on ANGLE Metal they over-reported against a
readback-synced wall clock by 2.6–4.3×, with a workload-dependent ratio. The numbers above
come from batches of 20 ticks ended by a position readback, interleaved with a collision-off
baseline, median of 7 rounds.

While the springs are hot, a hundred near-rigid springs per hub (d3's default per-link
strength is `1 / min(degree)`, so each leaf's spring is at full strength) compress the outer
shells, and the residual penetration tracks the remaining spring pull: it drains as alpha
does. One iteration instead of two leaves about 40 % more overlapping pairs at every alpha;
over-relaxing to 1.5–2 removes about 20–40 %. The story as committed (75 passes at 0.75,
gravity 0.35) has 205 shallow overlapping pairs at tick 2,000 and none at tick 4,000, where
the code before this change has 15,459, 13,641 of them deeper than 10 %.

## Example

`src/stories/forces/hub-clusters.ts` — Storybook **Examples → Forces → Collision vs Hub
Springs**. Seven hubs of size 30, each wired to 60–140 leaves of size 6–16 seeded in a
20-unit disc on top of it; springs at strength 1 asking for 5 units; collision at strength
0.75 with padding 1 and 75 passes per tick; gravity 0.35 holding the clusters together;
decay 5,000 so the hand-over from springs to collision is watchable within a minute. Those
75 all-pairs passes cost about 15.6 ms per tick on an M3 Max. The design doc `docs/collision-force/README.md` has the full
walkthrough of both paths.

## Notes

- The slot path's one approximation is sampling in cells denser than K, and the grid is
  sized to ¼ point per cell on average, so only a genuine pile is ever sampled — and a pile
  inflates past K per cell within a few passes.
- Peeling is one render pass per slot, so the slot path's cost is dominated by fixed
  per-pass overhead at small counts; around 4,096 points the two paths cost about the same,
  which is why the threshold stays there.
- Fixed in review before merge: the all-pairs pass skipped absent points only by a `NaN`
  position, but a point removed with an animated `setPointPositions` keeps a finite position
  on the GPU after the fade and kept pushing its former neighbours; it now tests `exit.G`
  like every other pass, with a regression test. A non-finite
  `simulationCollisionIterations` (`NaN` from an empty input, `Infinity`) now runs one pass
  instead of skipping collision or never returning.
- Under sustained compression past the packing limit — the 50k-point stress story, where
  gravity presses ~84 % area coverage (counting padding) into a disc — neither version can resolve. The new force
  leaves fewer deep overlaps (8,233 deeper than 10 % at tick 300 against 33,607) and halves
  the worst penetration, but spreads the rest into more shallow contacts (83,587 above 1 %
  against 54,195), and the shallow count keeps growing while gravity keeps pulling.
