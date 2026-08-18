# The many-body repulsion algorithm: grid pyramid + Monte-Carlo near field

This is a walkthrough of the repulsion force introduced in
[#240](https://github.com/cosmosgl/graph/pull/240) — what the old algorithm did, what the new
one does instead, and why the change matters. The code lives in
`src/modules/ForceManyBody/`; the short engineering records are
`history/2026/2026-07-08-many-body-repulsion.md` and (for the sampling-noise follow-up
described near the end) `history/2026/2026-08-14-nearfield-jitter.md`.

Since that follow-up the force has **two paths**: graphs of at most 4,096 points are computed
**exactly** — one all-pairs pass, no grid, no sampling (`force-allpairs.frag`, see
[Small graphs are exact](#small-graphs-are-exact-the-all-pairs-path)) — and everything below
describes the grid + Monte-Carlo machinery that larger graphs use.

## The problem both algorithms solve

Repulsion is an *n-body* force: every point pushes away every other point. Computed literally
that is n² pairs — at 100 000 points, ten billion pair evaluations *per simulation tick*. No
GPU does that at 60 fps, so every practical layout engine approximates: **distant mass may be
lumped together, close mass may not.** A point cares whether its neighbor is 3 or 5 units away;
it does not care whether a blob on the far side of the graph is at 4000 or 4002.

Both the old and the new algorithm follow that principle. They differ in *how* they lump the
far mass, and — decisively — in what they do up close.

## How the old algorithm worked

![Old algorithm: theta bands and own-cell centroid](e-old-theta-bands.svg)

The old code (`force-centermass.frag` + the old `force-level.frag`, still visible on `main`)
built a stack of grids over the space, each holding per-cell aggregates
`[Σx, Σy, count]` — a cell's **centroid** (center of mass) is `Σ/count`. Then, per point:

1. **Far field:** at each level, a *band* of cells — a ring whose width and position depended
   on the `simulationRepulsionTheta` parameter — was summed centroid-wise. Coarser levels
   handled farther rings.
2. **Near field:** at the deepest level, the point was repelled from **its own cell's
   centroid** — one force, from one averaged position.

This worked, but had three structural problems:

1. **The close force was purely radial.** The strongest interactions a point has are with its
   nearest neighbors, and the old code compressed all of them into a single centroid. A force
   from a centroid always points along the line through the centroid — there is *no tangential
   component*. A dense clump can inflate, but its points can never slide sideways past each
   other to rearrange. That is exactly the artifact you could see on dense hubs: they collapsed
   into flat disks and petal shapes instead of spreading into clouds.
2. **`theta` was a footgun.** The band boundaries moved with `simulationRepulsionTheta`. A
   wrong value either double-counted mass (over-repulsion) or skipped mass (holes in the
   force), and the right value depended on the graph. Users had to tune a parameter that only
   existed to patch the approximation's seams.
3. **Small graphs paid for an approximation they didn't need.** Two points sharing a cell
   repelled each other centroid-wise even when the whole graph had 500 points and exact forces
   would have been trivial.

## The new algorithm in one sentence

Keep the sound part — **coarser grids for farther mass** — but make the decomposition seam-free
(no `theta`), and replace the centroid near field with an **unbiased random sample of real
pairwise forces**, so close points repel each other *individually*.

The scheme is known in physics simulation as **P3M** (particle–particle / particle–mesh): a
mesh handles the far field, true particle–particle forces handle the near field. The same idea
already powers the 3D force on the `feat/3d` branch; #240 ports it back to 2D.

### Step 1 — aggregate the grid pyramid

Same raw material as before: a pyramid of grids at 4², 8², 16², … resolution, up to an adaptive
finest level of about **2·√n cells per axis** (floored at 8², capped at 512²). Each tick, every
point is drawn into each grid as a 1-pixel point with additive blending, accumulating
`[Σx, Σy, count]` per cell (`calculate-level.vert/frag`).

The 2·√n target means an *average of ¼ point per finest cell* — most cells are empty or hold
one point. Keep that in mind for step 3.

### Step 2 — the pyramid tiles space exactly once

![Grid pyramid coverage](b-grid-pyramid.svg)

The `theta` bands are gone. Instead there is one fixed, resolution-independent rule
(`force-level.frag`):

- The **coarsest level** applies centroid repulsion from *every* cell except the 3×3
  neighborhood around the point's cell.
- Each **finer level** takes over exactly that deferred 3×3 — which at double resolution is its
  aligned **6×6 child block** — and applies centroid forces there, again minus its *own* 3×3.
- After the finest level, the only region not yet accounted for is the finest 3×3 neighborhood.
  That is the **near field**, and it is the only part where the centroid trick would do damage
  (up close, direction errors matter). It gets step 3 instead.

Every cell of space is charged to exactly one pass: **no gaps, no double counting, nothing to
tune.** Far-field centroid error is negligible by construction, because a cell is only ever
used at a distance at least ~1 cell away from its own size scale.

### Step 3 — the Monte-Carlo near field

This is the heart of the change. The exact near-field force on a point is the sum of pairwise
forces from every other point in the 3×3 finest-cell neighborhood. Computing all of them is
O(occupancy²) per point — fine for sparse cells, fatal for a 1000-point hub cell. The new code
computes an **unbiased estimate** instead:

![Depth peeling and Horvitz–Thompson weighting](c-depth-peeling.svg)

**Sampling (`build-nearfield-slots.vert`):** every tick, each point gets a fresh pseudo-random
hash. K "depth peeling" passes then run over the finest grid; pass *k* selects, per cell,
the point with the smallest hash *not yet selected by passes 0..k−1* (the GPU depth test does
the per-cell minimum for free). After K passes, the K layers of a **slot array texture**
(`sampler2DArray`, one layer per pass) hold a uniform random K-subset of each cell's points —
re-drawn from scratch every tick.

**K adapts to the graph size** (`getNearFieldSlotCount` in `index.ts`): 32 slots up to 16k
points, 16 up to 65k, 8 above. Peeling is inherently sequential — one render pass per slot —
so K is a direct trade between per-tick cost and sampling variance; big graphs keep the cheap
estimator (per-point noise is sub-pixel at that scale), smaller ones buy more slots so that
realistic hub-cell occupancies are covered exactly. Each pass ping-pongs between two plain 2D
targets (pass *k* must sample pass *k−1*'s output, and sampling one layer of a texture while
rendering to another layer of the same texture is a WebGL feedback loop) and its result is
copied into its array layer.

**The hash must be an integer hash.** The first version used the classic
`fract(sin(index * 12.9898 + seed * 78.233) * 43758.5453)` one-liner, which is quietly broken at
this engine's scale: with hundreds of thousands of points the `sin()` argument reaches millions
of radians, where GLSL guarantees no accuracy and real GPUs diverge — [testing across
vendors](https://github.com/danilw/GPU-sin-hash-stability) shows sin-hashes produce different
(and sometimes visibly broken) values on NVIDIA vs AMD vs Apple vs mobile. Degraded precision
means correlated or *colliding* hashes, and a collision is not cosmetic here: the peeling
eligibility test (`hash <= previous slot's hash`) silently skips a tied point, so it can never
be sampled and the Horvitz–Thompson estimate loses its unbiasedness. The replacement is
**lowbias32**, an XOR-shift–multiply integer hash that sits on the quality/speed Pareto
frontier of [Jarzynski & Olano's GPU-hash study
(JCGT 2020)](https://www.jcgt.org/published/0009/03/02/paper.pdf) with the [lowest measured
bias of its class](https://fgarlin.com/blog/gpu-rng/). Integer ops are exact on every GPU, and
both inputs are exact (the point index is an integer-valued float; the per-tick seed enters via
`floatBitsToUint`), so the ordering is identical across platforms. Only the hash's top 24 bits
become the float ticket, so the value written to the slot texture round-trips bit-exactly into
the next pass's comparison. Cost is a wash: ~8 integer ALU ops replace a special-function-unit
`sin()`, in a pass dominated by texture fetches anyway.

**Estimation (`force-nearfield.frag`):** for each of the 9 neighborhood cells, the point sums
the true pairwise forces from the sampled slots (skipping itself), then scales the sum by

```
others / sampled        // e.g. cell holds 48 other points, 32 sampled → × 48/32
```

This is the **Horvitz–Thompson estimator**: since each of the cell's `others` points had equal
probability `sampled/others` of being in the sample, dividing by that probability makes the
*expected value* of the estimate equal the exact all-pairs sum. Unbiased — and with **no
centroid term**, so the tangential force component survives:

![Old centroid vs new pairwise near field](a-near-field-old-vs-new.svg)

Two properties fall out for free:

- **Sparse cells are exact.** A cell with ≤ K points is sampled exhaustively
  (`others == sampled`, weight = 1). With the finest grid at 2·√n per axis, the average cell
  holds ¼ point — so for typical graphs the near field *is* the exact all-pairs force, and the
  approximation only kicks in inside genuinely dense hubs.
- **The sampling noise is (mostly) a feature.** The estimate is unbiased but noisy, and the
  noise is re-rolled every tick. Because every force is scaled by `alpha`, the noise *anneals*:
  large early, when clumps need breaking apart, shrinking to nothing as the layout settles. It
  is precisely the jitter that lets stacked points find distinct directions to escape along.
  The caveat — and what the 2026-08-14 follow-up fixed — is layouts where the density never
  disperses: see [When the noise stops annealing](#when-the-noise-stops-annealing) below.

### Step 4 — two stability guards

Both live in `force-nearfield.frag`, both born from real failure modes:

- **Coincident points get a random kick.** Two points at *exactly* the same position have no
  separation direction — an inverse-distance force is undefined, so they would stay stacked
  forever, while their combined cell count repels everything else away, carving an empty "void
  ring" around the stack. Instead, each point kicks along its own per-point random vector, so a
  pile disperses.
- **Per-tick velocity clamp (2 × cell size).** The `others/sampled` weight is unbiased but
  high-variance: in a cell holding far more points than sampling slots, a couple of very close
  samples can be multiplied into a huge one-tick kick — flinging points across the screen at
  startup and ejecting points from dense cluster centers. The clamp caps the magnitude and
  keeps the direction; genuine spreading kicks are far below the bound, and bulk expansion is
  driven by the far-field levels anyway.

### The per-tick pipeline

![GPU pipeline](d-gpu-pipeline.svg)

Orchestrated by `src/modules/ForceManyBody/index.ts`:
`drawLevels()` → `drawNearFieldSlots()` → `drawForces()` (per-level force passes plus the
near-field pass, all blending additively into the shared velocity texture). Integration into
positions is the same step every other force uses. Small graphs replace all three with a
single `drawAllPairsForce()` pass — next section.

## When the noise stops annealing

The "noise is a feature" argument has a hole, found the hard way on a real graph (the
163-country border-adjacency network): it assumes the density that causes the sampling
variance *disperses*. Under pure repulsion it does — the clump expands, occupancy falls to ~K
within a second, and the noise dies with it, sub-pixel before anyone sees it. But when link
attraction or gravity holds a hub together *while alpha stays high* (a long-running layout, a
reheated one, `start()` on interaction), occupancy stays far above the slot count forever, and
the per-tick re-drawn sample turns into visible, permanent shimmer: measured on that country
graph, every point wandered ~0.5 units per tick with a ~92° mean direction change — a pure
random walk stacked on a settled layout, while an exact all-pairs reference under the same
integration was three orders of magnitude stiller.

Two changes closed it (2026-08-14):

1. **Small graphs skip the estimator entirely** — the all-pairs path below. This is the case
   where sustained dense hubs are both most common and cheapest to compute exactly.
2. **K became adaptive** (32/16/8 — see step 3). Mid-size graphs get 2–4× more samples, which
   both extends the exactly-covered occupancy range and shrinks the residual variance
   (amplitude ∝ occupancy/K · 1/√K) — while the ≥ 65k tier keeps today's 8-slot cost
   unchanged.

The **Performance → Near-Field Jitter: Country Borders** story reproduces this live: the
real graph that surfaced it, with alpha held at 1 and a sliding-window meter of per-tick
step, turn angle, and finest-cell occupancy versus the sampling slots.

## Small graphs are exact: the all-pairs path

At or below **4,096 points** (`ALL_PAIRS_MAX_POINTS`) the force runs as one full-screen pass
(`force-allpairs.frag`): each point loops over every other point and sums the same clamped
inverse-distance pairwise force the grid path uses, with the same coincident-point random
kick. No pyramid, no peeling, no sampling — the result is exact at *any* cell occupancy, so
there is no noise to anneal and nothing to shimmer.

It is also simply faster there. Depth peeling costs one render pass per slot, ~0.1 ms of
fixed overhead each; at 2k points, 64 experimental slots measured ~6.4 ms/step while the
single all-pairs pass measures **~1.8 ms/step** — n² texel loops are trivial work at this
scale (4096² ≈ 17M pair evaluations). The threshold sits where that stops being true: the
next power of two would already cost several milliseconds.

(#240 prototyped and dropped exactly this path, when the grid looked "effectively exact" for
small graphs. That held for dispersing layouts; the sustained-density case above is why it
came back.)

## Why it is better than the old one

| | Old (theta-banded quadtree) | New (grid + Monte-Carlo near field) |
|---|---|---|
| Close-range force | own-cell centroid — radial only | sampled real pairs — full direction |
| Dense hubs | collapse into disks / petals | spread into natural clouds |
| Stacked points | never separate (void rings) | random kick disperses them |
| Coverage seams | depend on `theta` tuning | exact once-tiling, nothing to tune |
| Small graphs (≤ 4,096 points) | always approximate | **exact** — dedicated all-pairs pass |
| Sparse cells (larger graphs) | always approximate | **exact** (cells ≤ K points, K = 8–32) |
| Bias | systematic (centroid direction) | none — unbiased estimator; noise anneals with alpha |
| `simulationRepulsionTheta` | required tuning | deprecated no-op (accepted, ignored) |
| Speed | baseline | **~1.2–4× faster per step** across the practical range |
| Code paths | one, plus the theta special-casing | two: exact ≤ 4k points, grid + sampling above |

The speedup comes from the fixed 3×3/6×6 loop structure (compact, coherent texel fetches;
no data-dependent band walking) — measure it yourself with the **Performance → Repulsion
Benchmark** story, which steps the simulation directly and forces a readback so the numbers aren't capped
by the display refresh rate. The before/after videos in the
[PR description](https://github.com/cosmosgl/graph/pull/240) show the visual difference on a
dense-hub graph.

## The trade, honestly

The old algorithm's error was a systematic *bias* — invisible per-frame, but it deformed
layouts (disks, petals, void rings) and never went away. The new algorithm's error is
*variance* — per-tick jitter in dense regions while `alpha` is high, centered on the exact
answer and vanishing as the simulation cools. For a layout engine that trade is right: the
final layout is what users keep, and the transient jitter is doing useful work (annealing) on
the way there. Where the variance stopped vanishing — sustained-density layouts — it was
removed outright (exact ≤ 4k points) or shrunk (adaptive K); the residual is confined to
over-K-occupancy hub cells in graphs above 4k points while alpha is high.

Cost side: the slot array texture plus two peel targets at the finest grid resolution (at the
512² cap with K = 8 that is 10 × 512² × 2 floats = 20 MB of GPU memory; smaller graphs have
more layers but a proportionally smaller grid) and the K peeling passes per tick — all already
included in the benchmark numbers above.

## Glossary

- **Barnes-Hut** — the classic n-body approximation: treat a far-away group of points as one
  point at their center of mass. Both algorithms use this for the far field.
- **P3M (particle–particle / particle–mesh)** — hybrid scheme: mesh (grid centroids) for far
  interactions, direct particle pairs for near ones. The new algorithm is a P3M with a
  Monte-Carlo particle–particle term.
- **Depth peeling** — running the same draw repeatedly, each pass "peeling off" the previous
  winner of the depth test to reveal the next one. Used here to extract the K smallest-hash
  points per cell, one per pass.
- **Horvitz–Thompson estimator** — weight each sampled item by the inverse of its inclusion
  probability; the weighted sample sum is then an unbiased estimate of the full-population sum.
- **Chebyshev distance** — `max(|Δx|, |Δy|)`; "Chebyshev ≤ 1" is the 3×3 neighborhood.
