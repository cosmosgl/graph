# The collision force: exact pairs below 4,096 points, depth-peeled neighbour slots above

This is a walkthrough of the collision force — what it does, why it is exact for small
graphs, how it stays linear-time on the GPU for large ones, and what its one approximation
costs. It was added in `feat(simulation): add spatial-hash point collision force` (`68492a9`),
made correct at every point size in `fix(force): cover the full collision range and unbias
cell averages` (`ca4ee44`) and `fix(force): keep the fitted collision cell at the interaction
range` (`58e2475`), and rebuilt as a constraint with pairwise contacts in
`feat(force): collision is a constraint — unscaled by alpha, integrated without friction` (`fcd1137`) and the commits that follow it on that branch, through `feat(force): depth-peeled neighbour slots replace the cell-average grid above 4,096 points` (`0ce67c7`). The code lives in
`src/modules/ForceCollision/`; the engineering records are
`history/2026/2026-06-13-collision-force.md` and `history/2026/2026-10-07-collision-constraint.md`.

The force is driven by five config keys (interface in `src/config.ts`, defaults in
`src/variables.ts`):

| Property | Meaning | Default |
|---|---|---|
| `simulationCollision` | Relaxation factor. `0` disables the force; resources are allocated on first use; `1` projects each overlapping pair to contact per pass; up to `2` over-relaxes. | `0` |
| `simulationCollisionRadius` | A fixed collision radius for every point. `0` or `undefined` derive it per point as `size / 2`. | `undefined` |
| `simulationCollisionPadding` | Extra room added to every radius, in space units, so neighbours settle `2 × padding` apart instead of touching. | `0` |
| `simulationCollisionIterations` | Collision passes per tick. More passes unwind a dense pile in fewer ticks, at a linear cost per pass. | `1` |
| `simulationCollisionCooling` | How much the correction cools with alpha, as the power alpha is raised to: `0` never, `1` like the other forces. | `0` |

GPU resources are allocated on the first collision pass. Setting `simulationCollision`
to `0` stops future passes but retains those resources for reuse; disabling the
simulation or destroying the graph releases them. A graph that never uses
collision never allocates its collision resources.

Throughout, **R** means a point's *effective radius*: the fixed radius or half its size, plus
the padding.

The force has two paths, split at **4,096 points** (`ALL_PAIRS_MAX_POINTS` in `index.ts`), the
same threshold the many-body force uses. At or below it, `force-collision-allpairs.frag`
tests every pair. Above it, `force-collision-slots.frag` tests every pair *within reach*: a
uniform grid whose cell spans the contact range, with each cell's occupants listed by depth
peeling so the force pass sees real neighbours, never a cell average. Both paths resolve a
contact the same way, and both treat collision as a **constraint**: the correction is not
scaled by the simulation's `alpha` (unless `simulationCollisionCooling` opts in), it is integrated without friction, and while collision is
on the link force floors every spring's rest length at the pair's contact distance.

## The problem this force solves

The many-body force repels point *centers* with an inverse-distance falloff. It has no idea
how big a point is drawn, so when size carries meaning — degree, a metric, importance — the
biggest points are exactly the ones that end up stacked on each other, illegible and
un-hoverable. What is missing is a **contact force**: one that acts only while two discs
interpenetrate, pushes them apart along the line between their centers, and vanishes the
moment they touch. That is `d3-force`'s `forceCollide`, and cosmos.gl's layout was modeled on
`d3-force`.

Contact is a pairwise question, so computed literally it is n² tests per tick. `d3-force`
avoids that with a quadtree rebuilt on the CPU every tick; cosmos.gl cannot — the whole
simulation has to stay on the GPU at hundreds of thousands of points, and there is no
readback in the loop. The task is to answer "who is touching me?" for every point in a fixed
number of texture reads.

## How a contact is resolved (both paths)

For every other point within reach, the shader does this (`d3-force`'s `forceCollide`,
without its random jiggle):

```
contact = R_self + R_other
if d < contact:
  push  = (contact − d) · R_other² / (R_self² + R_other²)   // the bigger disc yields less
  v    += push · (pos − otherPos) / d                       // along the line of centers
v  *= strength                                              // 1 = full projection per pass
|v| ≤ R_self                                                // per-pass cap: one own radius
```

A pair is resolved exactly in one pass: the two pushes sum to the overlap. A point in a pile
sums many of them, and the cap turns that into a bounded step away from where the pile is
densest, so a seeded pile inflates over a few passes instead of exploding. Coincident points
(no direction) push along a per-point golden-angle direction — consecutive indices fan out in
well-separated directions — so a stack disperses deterministically. An absent point is
skipped through the exit texture (`exit.G`), the test every other pass uses, never by its
position: a point removed with an animated `setPointPositions` keeps its last finite position
on the GPU after the fade.

**Strength above 1 is over-relaxation.** Each pass then over-projects, which is what a jammed
interior needs: a chain of compressed shells transmits a push one shell per pass with a
factor of about ½, and over-relaxing speeds that up. It does not ping-pong — a separated pair
receives no push — and the cap still bounds every step.

## Small graphs: the all-pairs path

At or below 4,096 points the force is one full-screen pass (`force-collision-allpairs.frag`):
each point loops over every other point. The loop rejects on position alone first — nothing
beyond `R_self + R_max` can touch — so the size and exit fetches are paid only for candidates.

**What it costs.** n² pair tests per pass: 1M at 1,000 points, 16M at 4,000. Measured end to
end on an Apple M3 Max, that is 0.42 ms and 2.66 ms per pass (see "What it costs" below).
Iterations multiply it. No grid, no slot textures.

## Large graphs: the slot path

### Step 1 — size the cell to the contact range

`create()` in `index.ts` sizes the grid from the physics first, then from the point count:

```
R_max = (fixed radius > 0 ? fixed radius : maxSize / 2) + padding   // largest R in the graph
grid  = min(⌊spaceSize / max(2 · R_max, 8)⌋, finestGridSize(n))       // cells per axis
cell  = spaceSize / grid
```

The `2 · R_max` is the whole argument. Two points of the largest radius touch when their
centers are `2R_max` apart, and the force shader scans only the 3×3 block around a point's
own cell — one cell of separation in each axis. **If the cell is at least the contact range,
the 3×3 scan is exhaustive**: no touching pair can sit in cells that are never compared.
Flooring the count keeps the fitted cell at or above that range (ceiling would divide the
space into cells slightly *smaller* than it, the bug the August fixes closed), and a large
radius legitimately wants a coarse grid.

`finestGridSize(n)` is the many-body force's finest grid for this point count, about `2·√n`
cells per axis, a power of two, capped at 512 (`src/modules/Shared/cell-slots.ts`). It is
the second bound for two reasons: it keeps the average occupancy near ¼ point per cell, so
the slots of step 2 list most cells in full, and it bounds the slot textures — K layers of
`grid²` texels — instead of letting a small radius push the grid to 512² however few points
there are. With the default 4,096-unit space, 5,000 size-16 points with padding 1 get a
227² grid of 18-unit cells: the contact bound (`2 · 9 = 18`) binds before the point-count
bound (256). With padding 0 both bounds give a 256² grid of 16-unit cells.

**The size is a per-graph maximum.** In derived-radius mode, `create()` loops over every
resolved point size (`getResolvedPointSize`, so a `NaN` "use the default" never poisons the
maximum, and a spread into `Math.max` never throws on a 50k-element array). One huge point
coarsens the grid for everybody; a fixed `simulationCollisionRadius` decouples the physics
from the drawing when that matters.

### Step 2 — list each cell's occupants by depth peeling

This is the many-body force's near-field machinery, reused as is
(`ForceManyBody/build-nearfield-slots.vert`, bound to the collision grid). Every pass, each
point gets a fresh pseudo-random hash. K "depth peeling" draws then run over the grid: draw
*k* selects, per cell, the point with the smallest hash *not yet selected by draws 0..k−1*
(the GPU depth test does the per-cell minimum for free). After K draws, the K layers of a
**slot array texture** (`sampler2DArray`, one layer per draw) hold, for every cell, either
all of its occupants or a uniform random K-subset of them — re-drawn from scratch every pass.

**K follows the many-body tiers** (`getNearFieldSlotCount`): 32 slots up to 16k points, 16
up to 65k, 8 above. A cell holding at most K points is listed in full and its contacts are
resolved exactly. A denser cell shows each point a fresh random K of its neighbours per
pass; every overlapping pair is reached sooner or later, and the per-pass cap keeps each step
bounded meanwhile. Because the grid is sized to ¼ point per cell on average, a cell exceeds
K only in a genuine pile — and a pile inflates past K per cell within a few passes.

Each draw ping-pongs between two plain 2D targets (draw *k* must sample draw *k−1*'s output,
and sampling one layer of a texture while rendering to another layer of the same texture is
a WebGL feedback loop) and its result is copied into its array layer. The hash is an integer
hash (lowbias32) for the reasons `docs/many-body-force/README.md` gives: a `sin()` hash
collides at this scale, and a collision silently drops a point from the sample.

### Step 3 — resolve real contacts

`force-collision-slots.frag` is a full-screen pass, one fragment per point. It computes its
own cell with the peel pass's exact formula, then for each of the 9 cells in the 3×3 block
walks the slots in order — an exhausted cell peels empty slots (index −1) for its remaining
layers, so the walk stops at the first — and applies the contact rule above to every listed
neighbour but itself. The output is written into the velocity texture and integrated once.

With `simulationCollisionIterations` above 1 the whole thing — K peel draws, the force pass,
one integration — repeats on the positions the previous iteration just wrote.

## Where it sits in the tick

`runSimulationStep()` in `src/simulation.ts` runs the forces in a fixed order — gravity,
center, many-body, links (incoming then outgoing), clusters, **collision** — and each force is
its own `swapFbo() → run() → updatePosition()` triple. There is no shared velocity sum: every
force reads the positions the previous force just wrote, writes its own velocity texture, and
the integrator applies it (`pos += v × friction`, clamped to the space) before the next force
runs.

Collision is deliberately **last**. Link springs and cluster attraction re-create overlap on
every tick; running collision after them corrects that overlap within the same tick. Running it
before them would leave the attraction's overlap standing until the next frame, and the two
would settle into a standing oscillation.

Collision is also the one force treated as a **constraint rather than a force**, in three
ways that together let it dominate a dense cluster:

- **No `alpha`, by default.** Every other force is proportional to the cooling factor. Alpha
  decays exponentially, so roughly the last two thirds of a simulation's ticks run below a
  tenth of full strength; a collision push that cooled with it froze whatever overlap the
  springs had introduced while hot. The shaders apply `strength` straight, and the per-pass
  cap is what keeps full strength stable at every alpha. `simulationCollisionCooling` opts
  back in, multiplying the correction by `alpha^cooling`: at `1` collision fades like the
  other forces, which suits a layout that stays under compression (the 50k stress story,
  where gravity presses past the packing limit) and would otherwise jitter for as long as the
  simulation runs — at the price of the overlap left when alpha is low.
- **No friction.** `updatePosition(1)` integrates the collision velocity with friction 1, so
  the bounded correction lands in full instead of losing 15 % to the integrator's damping.
- **The springs agree with it.** Before the forces run, the tick builds the collision
  resources (so the size texture exists) and hands that texture to both link passes. While
  collision is on, the link shader floors each spring's rest length at
  `R_self + R_other` — a rest length inside the two radii would pull the pair into overlap
  every tick and the two forces would settle wherever they balance, a guaranteed partial
  overlap. Lifting the rest length to contact removes the fight instead of relying on
  collision to win it; collision then only cleans up transients.

`simulationCollisionIterations` repeats the collision triple that many times per tick. A pile
unwinds about a layer per pass — a pushed point hands half its push on to the next shell —
and extra passes per tick are how a dense cluster inflates faster than its springs re-pile
it.

The force is **lazy and zero-cost when off**. `isForceCollisionReady` in `src/simulation.ts`
is the whole state machine: the size texture, the programs and — above the all-pairs
threshold — the two peel targets and the slot array are allocated the first time a tick runs
with `simulationCollision > 0` (ahead of the forces, so the link passes can read the size
texture), and a graph that never enables collision pays no memory and no compile. Anything
that changes the inputs flips the flag back and the next collision tick rebuilds:

| Change | Why it invalidates |
|---|---|
| point positions, sizes, or many-body data (`GraphSimulation.applyDataUpdates()`) | the size texture mirrors the point count and resolved sizes; the path and the slot tier follow the count |
| `simulationCollisionRadius`, `simulationCollisionPadding` | the cell size is derived from `R_max` |
| `pointDefaultSize` in derived-radius mode | `R_max` comes from sizes, and the default is one of them |
| `spaceSize` | the grid divides `adjustedSpaceSize` |

Changing `simulationCollision` or `simulationCollisionIterations` needs no rebuild — both are
read every tick — so they can be animated freely, including strength to `0` and back.

## What it costs

**Time.** A slot-path iteration is K point-list draws of n vertices plus K layer copies (the
peeling), then one full-screen pass of one fragment per point walking at most 9 × K slots;
an all-pairs iteration is one n² pass. Measured end to end on an Apple M3 Max (Chrome,
ANGLE Metal) as the per-tick difference against the same graph with collision off — a dense
disc, sizes 4–12, padding 1, an 8,192-unit space, median of 7 interleaved rounds of 20 ticks,
each tick synced by a position readback:

| Points | Path | Collision per tick, 1 iteration | 2 iterations | The cell-average grid it replaced |
|---|---|---|---|---|
| 1,000 | all-pairs | 0.42 ms | 0.83 ms | 0.09 ms |
| 4,000 | all-pairs | 2.66 ms | 5.38 ms | 0.10 ms |
| 5,000 | slots, K = 32, 256² | 2.44 ms | 4.91 ms | 0.29 ms |
| 16,000 | slots, K = 32, 256² | 2.98 ms | 5.50 ms | 0.34 ms |
| 50,000 | slots, K = 16, 512² | 0.70 ms | 2.23 ms | 0.45 ms |
| 100,000 | slots, K = 8, 512² | 0.65 ms | 1.39 ms | 0.79 ms |
| 200,000 | slots, K = 8, 512² | 1.17 ms | 2.29 ms | 1.40 ms |

The slot path's cost is dominated by K: each peeled slot is a render pass with a fixed CPU
and GPU cost, so 16,000 points (32 slots) cost more than 200,000 (8 slots), though at a fixed
K it still grows with n (0.65 → 1.17 ms from 100k to 200k at K = 8). At K = 32 about 1.3 ms of
the 2.4–3 ms is main-thread time. At 50,000 points the first pass measured 0.70 ms, but each
further pass adds about 1.5 ms (two cost 2.23 ms, and the 50k stress story's five cost
6.7 ms), so plan on about 1.5 ms per pass there. The all-pairs side grows with n². Around the
threshold the two cost about the same, which is where it sits. The many-body force pays a
peel of its own at the same tiers.

**Memory.** Two peel targets of `grid² × 8 B` with a 32-bit depth attachment each, plus the
slot array of `K × grid² × 8 B`. With small radii the grid follows the point count, so the
total peaks between 16k and 65k points: about 18 MB up to 16k (256², 32 slots), about 40 MB
from 16k to 65k (512², 16 slots) and about 23 MB above (512², 8 slots), plus 16 B per point
of sizes. Larger radii coarsen the grid and shrink all of it. The cell-average grid it
replaced held four 512² RGBA32F textures, 17 MB, at the default point size. None of it exists
until the force first runs, and none of it on the all-pairs path.

## What sampling costs

The slot path has exactly one approximation: a cell holding more than K points shows each
neighbour a random K of them per pass. Three consequences:

- **Exactness has a density threshold, not a size threshold.** Any pair in reach is tested
  whenever both cells are within K; only a genuine pile is sampled, and only while it is one.
- **A sampled pile converges stochastically.** Each pass resolves the sampled contacts in
  full and ignores the rest; the next pass draws others. Measured on 100-point piles seeded
  in a 20-unit disc (well above 32 per cell at the start), one iteration: 27 pairs deeper
  than 10 % at tick 100 at 5,000 points and 296 at 50,000, and at most 4 shallow ones left by
  tick 300 — the same course as the exact path at 2,000 points (8 deep at tick 100, none by
  300). Two iterations leave none deeper than 10 % at tick 100.
- **It stops when the simulation does.** The push does not fade with `alpha`, but the loop
  still ends at `ALPHA_MIN`; an overlap still unwinding then stays until the layout is next
  reheated. `simulationDecay` is roughly the number of ticks until that floor.

The cell-average contact model this replaced had a different and worse failure: a point got a
push only while it overlapped a cell's *mean*, so pairs could sit inside each other while
every mean was out of range, and near-coincident points saw the same field and never parted.
Measured on the hub story with every other force off, it plateaued at 1,836 overlapping
pairs from tick 2,000 to tick 10,000. Depth peeling is what the many-body force adopted when
its own centroid near field hit the same wall, and the same shader now serves both.

## Not a `d3-force` clone

| | `d3-force` `forceCollide` | cosmos.gl collision |
|---|---|---|
| neighbour search | quadtree, exact pairs, CPU | exact pairs ≤ 4,096 points; uniform grid with depth-peeled slots above, GPU |
| per-tick cost | typically O(n log n) plus `iterations` sweeps | ≤ 4,096: one n² pass; above: K draws + one pass, O(n) — times `simulationCollisionIterations` |
| response | linear in overlap, split between the pair by `r²` | the same `r²` split, capped at one own radius per pass |
| overlap depth handled per pass | full | full for a pair; a pile's sum is capped, so it unwinds over passes |
| coincident points | random jiggle | deterministic golden-angle fan-out by index |
| `alpha` | ignored | ignored; integrated without friction too |
| springs vs. contact | the app sets `linkDistance` to clear the radii | rest length floored at the contact distance while collision is on |
| dense cells | exact, slower | exact up to K per cell; a random K per pass above |

## Tuning guidance

- **Link distance no longer has to clear the radii.** While collision is on, each spring's
  rest length is floored at the pair's contact distance, so a `simulationLinkDistance` smaller
  than the radii simply means "as close as contact allows". The **Forces → Collision vs Hub
  Springs** story leans on this: strong springs asking for 5 units, leaves sized up to 16.
- **Iterations are the knob for dense piles.** A hub with a hundred leaves re-piles them
  every tick; two to four passes per tick let the pile unwind faster than it is rebuilt. The
  cost is linear in the count and the default of 1 is right for sparse graphs.
- **Strength is a relaxation factor.** 1 projects each pair fully per pass, below 1
  under-relaxes (the stress test's 0.25 settles gently), and 1.5–2 over-relaxes, which jammed
  piles under strong springs reward. Measured on the hub story's data with gravity 0.1 and
  one iteration, at 3,000 ticks: 1,072 overlapping pairs at strength 1, 823 at 1.5, 630 at 2.
  The story itself goes the other way — 75 under-relaxed passes at 0.75 — and resolves fully.
- **Padding is the knob for breathing room.** It composes with both radius modes and enters
  the cell size, so raising it a lot coarsens the grid; a couple of units is typical.
- **A fixed radius decouples physics from drawing.** Useful when one giant point would
  otherwise dictate the cell size for everyone, or when the visual size animates but the layout
  should not.
- **Give it time.** The push is capped, so a deep pile takes ticks to unwind; a slow decay
  (`simulationDecay` in the tens of thousands) keeps the loop alive long enough. Friction no
  longer matters to collision — its correction is integrated with friction 1.

## Glossary

- **Spatial hash** — a uniform grid used as a lookup structure: a point's cell is a pure
  function of its position (`⌊p / cell⌋`), so neighbours are found by looking at adjacent cells
  rather than by walking a tree. Here the grid is a texture and the "hash" is the texel index.
- **Contact range** — the center distance at which two discs touch, `R₁ + R₂`; `2R_max` for
  the largest radius, and the reason the cell is at least `2R_max`.
- **Depth peeling** — running the same draw K times, each pass "peeling off" the previous
  winner so the depth test selects the next one; here it lists a cell's occupants in random
  order, K per cell.
- **Slot** — one layer of the slot array texture: per cell, the point index (and hash) that
  one peeling pass selected, or −1 if the cell was exhausted.
- **Relaxation** — resolving a constraint by repeated small, bounded corrections rather than
  one exact solve; the per-pass cap makes collision a relaxation, and `strength` is its factor.
- **Alpha** — the simulation's global cooling factor, from 1 at start to `ALPHA_MIN`
  (`0.001`) when it stops; every force except collision is proportional to it, and collision
  only to the power `simulationCollisionCooling` sets.
