# The collision force: exact pairs below 4,096 points, depth-peeled neighbour slots above

This is a walkthrough of the collision force — what it does, why it is exact for small
graphs, how it stays linear-time on the GPU for large ones, and what its one approximation
costs. It was added in `feat(simulation): add spatial-hash point collision force` (`68492a9`),
made correct at every point size in `fix(force): cover the full collision range and unbias
cell averages` (`ca4ee44`) and `fix(force): keep the fitted collision cell at the interaction
range` (`58e2475`), and rebuilt as a constraint with pairwise contacts in
`feat(force): collision is a constraint — unscaled by alpha, integrated without friction` (`930d3a3`) and the commits that follow it on that branch, through `feat(force): depth-peeled neighbour slots replace the cell-average grid above 4,096 points` (`dbce291`). The code lives in
`src/modules/ForceCollision/`; the engineering records are
`history/2026/2026-06-13-collision-force.md` and `history/2026/2026-10-07-collision-constraint.md`.
This is a walkthrough of the collision force — what it does, how it stays linear-time on
the GPU, and what its approximation costs. It was added in
`feat(simulation): add spatial-hash point collision force` (`68492a9`) and made correct at
every point size in `fix(force): cover the full collision range and unbias cell averages`
(`ca4ee44`) and `fix(force): keep the fitted collision cell at the interaction range`
(`58e2475`); `fix(force): anchor the collision hash to the data — it was inert outside the
space` took the grid off the simulation space, so that collision works wherever a layout
goes once `spaceSize` no longer confines it. The code lives in `src/modules/ForceCollision/`;
the short engineering records are `history/2026/2026-06-13-collision-force.md` and, for the
move off the space, `history/2026/2026-10-14-unbounded-space.md`.

The same story as a standalone explainer — the four causes and their fixes, the contact rule and
the two paths, each with a live demo, and the tick order — is
[`collision-constraint.html`](./collision-constraint.html) (self-contained; open it locally in a
browser — GitHub shows only its source).

The force is driven by five config keys (interface in `src/config.ts`, defaults in
`src/variables.ts`):

| Property | Meaning | Default |
|---|---|---|
| `simulationCollision` | Relaxation factor. `0` disables the force; resources are allocated on first use; `1` applies the full pairwise correction before each point's radius cap; deep overlaps can need multiple passes. Up to `2` over-relaxes. | `0` |
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
tests every pair. Above it, `force-collision-slots.frag` tests the pairs *within reach*, every one
while a cell holds at most K points and a fresh random K of a denser cell's occupants per pass:
a uniform grid whose cell spans the contact range, with each cell's occupants listed by depth
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
v  *= strength                                              // 1 = full correction before the cap
|v| ≤ R_self                                                // per-pass cap: one own radius
```

For a noncoincident pair at strength 1, the two uncapped pushes sum to the overlap.
The per-point radius cap can limit even an isolated pair's correction, so deep overlaps may
need multiple passes. A point in a pile sums many corrections, and the cap turns that into
a bounded step away from where the pile is densest, so a seeded pile inflates over a few
passes instead of exploding. Coincident points
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
Bin every point into uniform cells that span the whole contact range, so that each point's
3×3 cell neighbourhood is guaranteed to contain every point it can touch — counting the cells
from the data and hashing them onto a fixed texture, so they follow the layout wherever it is;
then let the point react to the **average** of the other points in each of those nine cells, as
if the cell were one disc of averaged size and position — and do that four times on
half-cell-shifted grids so that a contact split by a cell boundary is caught by one of them.

Four ideas, one per step below: the cell size, the hash that places the cells, the four offset
grids, the averaged contact.

### Step 1 — size the cell to the contact range

![Why the cell spans 2R](a-contact-range.svg)

`create()` in `src/modules/ForceCollision/index.ts` sizes the cell from the physics, not from
the point count or the layout:

```
R    = (fixed radius > 0 ? fixed radius : maxSize / 2) + padding   // largest R in the graph
cell = max(2 · R, 8)                                                // never refitted
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
That is exactly the bug the August fixes closed. The original cell was one `R`, and an
8-unit floor hid it: at the default size of 4 (`R = 2`) the floor made the cell 8, which
happened to span the range, so collision looked fine in every default demo and quietly failed
for anything larger. Measured with collision as the only force, settled: 200 points at size
30 left 79 overlapping pairs, the worst interpenetrating by 24 % of a diameter; 40 points at
size 100 left 18 pairs. Both go to zero with the cell at `2R`. The second fix concerned the
grid's fit to the space: the cell used to be refitted so that a whole number of cells covered
`[0, spaceSize]`, and rounding that count *up* made the cell slightly *smaller* than
requested, while a 32-cell minimum pinned it at `spaceSize / 32` however large the radius grew
— so above `R = 64` the gap reopened completely (30 points at size 300: 26 overlapping pairs,
none once the count rounded down). There is no fit any more: the cells are counted from the
data and hashed onto a fixed grid (step 2), so the cell is the contact range, floored at 8
units, at every radius and every layout size. It is never refitted to the layout: a smaller
cell would leave touching pairs uncompared, and a cell widened to cover more ground turns its
centroid into a wrong push (step 2 measures it).

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
- **The cell is sized by the largest point, not by n.** This is the opposite of the many-body
  grid, whose finest level tracks `2·√n`. Bigger points ⇒ bigger cells ⇒ more points per
  cell ⇒ a coarser approximation (step 4). The grid texture is a fixed 1024² whatever the cell;
  how wide a layout it holds without sharing a texel grows with the cell (step 2).
- **The size is a per-graph maximum.** In derived-radius mode, `create()` loops over every
  resolved point size (`getResolvedPointSize`, so a `NaN` "use the default" never poisons the
  maximum, and a spread into `Math.max` never throws on a 50k-element array). One huge point
  coarsens the cells for everybody; a fixed `simulationCollisionRadius` decouples the physics
  from the drawing when that matters.

### Step 2 — count the cells from the data, hash them onto a fixed grid

A cell size alone does not say where the cells are. The grid used to start at world zero and
cover `[0, spaceSize]`, which was safe only while positions were clamped into the space.
Without the clamp, every point outside the space lands in an edge cell — and since the force
compares a point with each neighbouring cell's *centroid*, and pushes only within contact range
of it, a cell holding a whole cluster reports the cluster's own average and never fires. Not
degraded: inert, with nothing on screen to say so. With the clamp deleted and nothing else
changed, an overlapping 800-point cluster of size 12 spread from 120 to 246 units at the centre
of the space, and stayed at 119.7 at 20,000 or −9,000.

So the cells are counted from the data and wrap onto a texture of a fixed size
(`collision-grid.ts`):

- **The origin is this tick's data bounds.** Collision runs its own `DataBounds`, the GPU
  reduction the many-body grid fits itself to
  ([its step 1](../many-body-force/README.md#step-1--fit-the-grid-to-the-data)): collision is
  opt-in and must work with repulsion off, and it runs after the link and cluster sub-steps
  have moved the points, so it reduces the positions it is about to bin. The cells are
  counted from the box's origin and the sums are taken relative to its centre; the cell size
  never derives from the box — it is the contact range, not a fraction of the box. The box is
  floored at the grid's width (`cell × 1024`), which centres a narrower layout in it, so the
  origin follows the layout's centre and holds still while the layout grows or shrinks evenly.
  A box fitted to the points would put the origin on their minimum corner, which moves
  whenever an extreme point does and re-cuts every cell under points that have not moved: on
  the collision stress test that cost 5–9 % more deep overlaps than the old space-anchored
  grid; floored, as few or fewer.
- **The cell is never widened to fit.** The force reads a cell's centroid, which stands in for
  the cell's points only while the cell stays close to the range they collide over. Widening
  it to fit a fixed texel count over the layout was tried, and measured worse than no collision:
  500 overlapping clusters with one point 7,000 units away (a 13.7-unit cell where the cell
  would be 8) ended with 33,621 deep overlaps, from 19,865 at the start. With the cell kept at
  8 units the same scene ends with 6,573, about the 6,548 it reaches without the far point
  (6,166–6,584 at box sizes up to 1e5).
- **So the 1024² grid is a spatial hash.** Cells run unbounded and wrap onto it. A plain modulo
  would hide the same points on every pass and every tick — a point whose texel is shared loses
  its collision for good — and with three blocks of cells in a line would put the centroid of
  the outer two onto the middle one: a phantom neighbour pushing its points the wrong way.
  Instead each axis of a cell is rotated by `r(k) = a·k² + b·k`, `k` the cell's block along the
  *other* axis, with `a` and `b` per offset lattice and a per-tick seed added to `b`. The
  origin's block is not rotated at all, so inside it the hash is a plain grid; the cells that
  share a texel change from pass to pass and from tick to tick, so no point stays hidden; and
  since `r`'s second difference never vanishes, the centroid of two cells symmetric about a
  third lands at least 37 cells from it (for blocks up to 31 apart).

Up to **1,022 cells** wide — 8,176 units at the default point size, whose cell is the 8-unit
floor — a layout shares no texel and bins exactly as on a plain grid: the floored box
centres it in the origin's block. (Only a box stretched by far-flung points can put a narrow
part of a layout across a block corner, where cells of the two diagonal blocks may share
texels.) Wider, cells a grid's width apart share texels. A shared texel's centroid is out of
reach of either cell's points, so it pushes nobody, but its count still adds to the density
damping of the points that scan it (step 4), and resolution slows: Gaussian cluster fields
9,000 to 30,000 units wide keep 10–71 % more overlapping pairs than an unshared 4096² grid
after 600 steps. The rotation is what keeps that a slowdown: 300k points in
1,000 clusters over 9,000 units ended with 477 deep overlaps, against 388 unshared and 52,408
with a plain modulo; and a point midway between two others two grid widths apart is left
alone, where a plain modulo pushed it 5.4 units.

Two details keep the binning identical in both programs, and a third keeps the sums precise.
Both programs that bin a point — the build pass and the force pass — splice in the same code
(`withCollisionGrid`), and like the many-body grid's cell formula it rounds only in a
subtraction and a product, which GLSL ES requires to be correctly rounded: the cell's
reciprocal is taken once on the CPU and passed to both as the same uniform bits. The half-cell
shift of the offset lattices (step 3) is applied after the rounding, in integers — positions
are binned into half cells, and a cell is two of them — because a shift added in world units is
not exact: ANGLE's Metal backend reassociates float arithmetic, and a compiler may fuse
`q · s + ½` into one fma in one program and round it twice in the other. With coordinates
planted within 3 ULPs of half-cell boundaries, −40,000 to 40,000 cells from the origin, both
programs agree on every cell, on Metal and SwiftShader alike. And the grid accumulates
positions relative to the centre of the data box rather than to world zero, so its float sums —
and the centroids taken from them — are as precise wherever the layout sits as around the
origin.

### Step 3 — build the grid, four times

`build-grid.vert` / `build-grid.frag` draw every point as a 1-pixel point into the grid
texture, at the texel its cell hashes to, with additive blending, so each texel accumulates
`[Σx, Σy, Σsize, count]`. Absent points (a `NaN` position, see
`history/2026/2026-06-27-nan-point-removal.md`) are culled here, and so is a present point whose
position is not finite: a `NaN` bins to a `NaN` cell and would poison every sum it touched.

The binning runs **four times**, each on a lattice shifted by half a cell: offsets `[0, 0]`,
`[½, 0]`, `[0, ½]`, `[½, ½]`. The reason is not reach — the offsets never extend the search
radius, which step 1 already settled — but the averaging in step 4:

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
center, many-body, links (incoming then outgoing), clusters, attractors, **collision** — and each force is
its own `swapFbo() → run() → updatePosition()` triple. There is no shared velocity sum: every
force reads the positions the previous force just wrote, writes its own velocity texture, and
the integrator applies it (`pos += v × friction`, clamped to the space) before the next force
runs.
The four lattices share **one** 1024² grid texture. Each offset pass rebuilds it and runs its
force pass (step 4) before the next pass rebuilds it on the next lattice; the velocity texture
is cleared by the first force pass only and blended into after, so it sums the four passes'
forces in the same order one pass over four grids would — at a quarter of the memory.

### Step 4 — resolve against the cell averages

`force-collision-spatial.frag` is a full-screen pass, one fragment per point. For each of the
9 cells in the 3×3 block around its own cell it reads the one texel that cell hashes to and
does this (positions, like the grid's sums, relative to the data box's centre):

```
count, Σpos, Σsize ← cell                         // own cell: subtract yourself first,
                                                  //   skip the cell if nobody else is in it
avgPos  = Σpos / count       avgR = (Σsize / count) / 2 + padding
Rc      = R_self + avgR                            // combined radius: contact distance
d       = |pos − avgPos|

if d < Rc:                                        // overlapping the averaged disc
  overlap = (Rc − d) / Rc                          // 0 = touching, 1 = concentric
  push    = alpha · strength · √overlap · Rc / 2 · ¼ · count
  push    = min(push, Rc / 2)                      // per-cell cap
  v      += push · (pos − avgPos) / d              // straight away from the average
```

The **self-subtraction** is the second half of the August fix. The point's own position and
size are in its own cell's sums; leaving them in drags the average toward the point and
halves the measured distance for a two-point cell, so every own-cell overlap was overstated.
Removing them first — and skipping the cell when it then holds nobody — makes the own-cell
average the mean of the *other* occupants, which is what the neighbour cells already were.

The **`count` factor** treats the cell as `count` discs stacked at the average — a crowded
cell pushes harder than a lone neighbour. That would blow up in a dense pile, so after the
loop two normalisations run:

```
if neighbours > 2:  v *= 2 / neighbours            // density damping: ≈ two neighbours' worth
|v| ≤ 0.1 · R_self                                 // per-pass cap
```

Together they mean the count weighting mostly *distributes* the push among the nine cells by
population, while the total stays bounded: a point in a crowd gets roughly two neighbours'
worth of push, aimed away from where the crowd is heaviest.

![The per-pass push and its caps](c-force-curve.svg)

The **square-root curve** is concave: most of the response is already there at a shallow
overlap and deeper overlap adds little. Combined with the **per-pass cap of 10 % of the
point's own radius**, this is what turns overlap resolution into *relaxation*. At strength 1
with equal radii the cap binds at 16 % overlap — beyond that the point simply moves a tenth of
its radius per pass, up to 40 % of its radius per tick across the four passes, then times the
integrator's friction — so a deep pile unwinds over a few ticks instead of being flung apart
in one and ping-ponging back. Below 16 % the curve tapers the push to zero, so a pair settles
at contact instead of dithering across it. At low strength (the stress test uses 0.25) the cap
never binds and the curve alone shapes the push.

Two more guards, both born from real failure modes:

- **Coincident points get a deterministic fan-out.** If a point sits on a cell's average (two
  points seeded at the same position, or a pile at one spot) there is no direction to push
  along. The shader kicks along an angle of `index × 0.618…` radians — the golden-ratio
  conjugate, so consecutive indices fan out in well-separated directions — with a bounded
  magnitude, and the pile disperses. (The many-body force solves the same problem with a
  per-point random vector; here the index is the only per-point value at hand, and determinism
  is a feature: the same input always unstacks the same way.) "On" means closer than the
  rounding error of the cell's float sums, `d ≤ max(0.001, |Σpos| · 2⁻²³)`: past that the
  direction to the average is noise, and a stack of a few hundred points a thousand units from
  the data's centre read its noise as one common direction and moved as a block.
- **No edge to fall off.** The force pass hashes each of its nine neighbours exactly as the
  build pass hashed every cell, so a point far outside the space scans a full 3×3
  neighbourhood like any other. The space-anchored grid had an edge: both passes clamped cells
  to it, so a point beyond the space at least read the edge cell it had been binned into — the
  cell that, holding a whole cluster, made collision inert out there (step 2).

The output is written into the velocity texture, and the four offset passes blend into it
additively before a single integration.

## Where it sits in the tick

![Tick order and the collision pipeline](d-tick-pipeline.svg)

`GraphSimulation.runSimulationStep()` in `src/simulation.ts` (which `Graph` drives) runs the
forces in a fixed order — gravity, center, many-body, links (incoming then outgoing), clusters,
**collision** — and each force is its own `swapFbo() → run() → updatePosition()` triple. There
is no shared velocity sum: every force reads the positions the previous force just wrote,
writes its own velocity texture, and the integrator applies it (`pos += v × friction`) before
the next force runs. The integrator bounds a step's length, not where it lands: a non-finite
step is dropped, one longer than `spaceSize` is shortened to it, and nothing holds a point
inside the space — which is why collision has to work wherever the points are (step 2).

Collision is deliberately **last**. Link springs, cluster attraction and attractors re-create overlap on
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
| `simulationCollisionRadius`, `simulationCollisionPadding` | the cell size is derived from `R` |
| `pointDefaultSize` in derived-radius mode | `R` comes from sizes, and the default is one of them |
| `spaceSize` | the grid divides `adjustedSpaceSize` |
is the whole state machine: the grid texture, the data-bounds targets, the size texture and
both programs are allocated the first time collision actually runs, so a graph that never sets
`simulationCollision > 0` pays no memory and no compile. Anything that changes the inputs flips
the flag back and the next collision tick rebuilds:
| point positions, sizes, or many-body data (`applyDataUpdates`) | the size texture mirrors the point count and resolved sizes |
`spaceSize` is not in the table: nothing in the force depends on it. The grid is a fixed size,
and where its cells fall is recomputed from the data every tick.

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
**Time is O(n) with a fixed constant, independent of density.** A tick is the data-bounds
reduction, then four point-list draws of n vertices (the binning) and four full-screen passes
of one fragment per point, each doing nine grid fetches plus its own position and size. How
many points share a cell does not change that: a cell is one texel however crowded it is. Crowding costs *quality* — the
average stands in for more individuals — and *ticks to converge*, not time per tick. The
**Performance → Collision (50k points)** story is the worst case: 50,000 sized points seeded
in a dense disc with repulsion off and a gentle gravity holding them packed, so collision has
to keep resolving overlap every tick, with the FPS monitor on. All told — reduction, hash and all —
collision costs a fixed ~0.3 ms per step more than the space-anchored grid it replaced, on an
M3 Max: 9–13 % of a step at 5k–20k points, 2–3 % at 100k, and over half for a few hundred
points, whose step costs little else.
**Memory** is one 1024² `rgba32float` grid texture, 16 MiB whatever the point size (the four
512² grids the default point size used to get came to the same; bigger points got a coarser
grid and less), plus the data-bounds reduction's small targets (~65 KB) and a size texture of
16 bytes per point. None of it exists until the force first runs.

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
- **Masked contacts.** A neighbour cell's mean can sit outside contact range while one of its
  members is overlapping you (the figure in step 3). The four offsets make this unlikely, not
  impossible — a pair surrounded by enough far-side mass in every partition is missed in all
  four.
- **Phantom pushes.** Conversely, a cell's mean can sit *inside* contact range while no
  individual member touches you — two points flanking you on either side average to your own
  position's neighbourhood — and you are pushed off a disc that isn't there.
- **Shared texels past 1,022 cells.** A layout wider than the hash's alias-free span
  has cells sharing texels (step 2). A shared texel's centroid is out of reach of both cells'
  points, so it pushes no one, and the rotation moves the sharing from pass to pass and tick to
  tick, so no point is hidden for good — but each shared texel is a pass without collision for
  the points in it. Wide layouts resolve slower, and one that occupies a fair fraction of the
  grid's million texels shares on every pass: a million points spread evenly over a square two
  grid widths wide went from 376k overlapping pairs to 827 in 200 steps, against 121 unshared.
- **Radial only.** Every push points straight away from an average, the same limitation the
  old many-body near field had. Collision gets away with it because it is a local contact
  force stacked on top of the many-body repulsion, which now supplies the tangential mixing
  (`docs/many-body-force/README.md`); on its own, collision would flatten a pile before it
  spread it.
- **Residual jitter in dense regions.** The same point sees four different averages per tick
  and a different neighbourhood next tick as things move; in a cell far above one occupant the
  four pushes do not agree, and the per-pass cap turns that disagreement into a small dither
  rather than a fling.
- **It fades with alpha.** Like every cosmos.gl force the push is scaled by `alpha`, so as the
  simulation cools the correction shrinks to nothing, and an overlap that was still relaxing
  when alpha hit its floor stays. `simulationDecay` is roughly the number of ticks until that
  floor; both collision stories set it to `100000` so the layout keeps resolving for as long as
  anyone watches. (`d3-force`'s `forceCollide` ignores alpha altogether.)

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
| neighbour search | quadtree, exact pairs, CPU | spatial hash of uniform cells, cell averages, GPU |
| per-tick cost | typically O(n log n) plus `iterations` sweeps | O(n) fixed: a bounds reduction, then 4 draws + 4 passes |
| response | linear in overlap, split between the pair by `r²` (a small disc yields to a big one) | `√overlap`, symmetric before caps; caps scale with each point's own radius |
| overlap depth handled per pass | full | capped at one own radius, including isolated pairs; deep overlaps can need multiple passes |
| overlap depth handled per tick | full, over `iterations` (default 1) | relaxation: ≤ 0.4 × own radius per tick |
| coincident points | random jiggle | deterministic golden-angle fan-out by index |
| `alpha` | ignored | ignored by default, `simulationCollisionCooling` opts back in; integrated without friction too |
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
- **Strength is a relaxation factor.** 1 applies the full pairwise correction before the
  per-point radius cap; below 1 under-relaxes (the stress test's 0.25 settles gently), and 1.5–2 over-relaxes, which jammed
  piles under strong springs reward. Measured on the hub story's data with gravity 0.1 and
  one iteration, at 3,000 ticks: 1,072 overlapping pairs at strength 1, 823 at 1.5, 630 at 2.
  The story itself goes the other way — 75 under-relaxed passes at 0.75 — and resolves fully.
- **Padding is the knob for breathing room.** It composes with both radius modes and enters
  the cell size, so raising it a lot coarsens the cells; a couple of units is typical.
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
  function of its position (`⌊(p − origin) / cell⌋`), so neighbours are found by looking at
  adjacent cells rather than by walking a tree. Here the cells are counted from the data's
  origin without bound and wrap onto a fixed 1024² texture, each axis rotated by the cell's
  block along the other axis; the "hash" is the texel a cell lands on.
- **Data bounds** — the live points' bounding box, reduced on the GPU every tick
  (`src/modules/Shared/data-bounds.ts`); collision counts its cells from the box's origin and
  takes its sums relative to the box's centre, but never derives its cell size from it.
- **Contact range** — the center distance at which two discs touch, `R₁ + R₂`; `2R` for the
  largest radius, and the reason the cell is `2R` (floored at 8 units).
- **Cell average** — a cell's `Σ / count`; the one averaged disc the point reacts to in place
  of that cell's individual members.
- **Offset (staggered) grids** — the same grid shifted by a fraction of a cell; averaging
  over several partitions removes the dependence on where the boundaries happened to fall.
- **Relaxation** — resolving a constraint by repeated small, bounded corrections rather than
  one exact solve; the per-pass cap makes collision a relaxation, and `strength` is its factor.
- **Alpha** — the simulation's global cooling factor, from 1 at start to `ALPHA_MIN`
  (`0.001`) when it stops; every force, collision included, is proportional to it.

Regenerate the figures with `node gen-diagrams.mjs` from this folder. The grid panels bin
points with the same rules as the shaders and assert the story they tell, so keep the
script's constants in sync with `src/modules/ForceCollision/index.ts` and `collision-grid.ts`
when the algorithm changes.
  (`0.001`) when it stops; every force except collision is proportional to it, and collision
  only to the power `simulationCollisionCooling` sets.
