<!-- suggested path: history/2026/2026-10-14-unbounded-space.md -->

# Unbounded space: `spaceSize` places the world instead of walling it in

**Date:** 2026-10-14
**Commits:** `feat(stories): add Space Size Wall — measure where spaceSize stops the layout` (`c2f9f43`), `refactor(store): name the world origin the view has always been centred on` (`02883ea`), `fix(zoom): lower the zoom-out floor that silently cut large fits short` (`e572df5`), `feat(force): the many-body grid follows the data, not the space` (`94a354a`), `fix(force): anchor the collision hash to the data — it was inert outside the space` (`4f04e3e`), `feat(points): remove the position clamp — spaceSize no longer confines a layout` (`fd67d37`), `docs: the force and embedding docs describe an unbounded space` (`8e413fc`), `refactor(space): name what spaceSize still sets, and deprecate the key` (`3a0dae6`), `test(force): the collision hash tests run above the all-pairs threshold — they were testing the exact path` (`797eddf`), `test(force): probe the collision programs' binning agreement with overlapping pairs — an isolated point cannot see it` (`e8d24d4`), `fix(deck-layers): getBounds measures the layout without a stall — deck reads it every frame` (`f7ad83f`), `fix(store): resolve spaceSize when the simulation is made — a host read the default origin until the device arrived` (`ce52f82`), `refactor(force): count collision cells from the world origin — the bounds it reduced were read for one number` (`3315ffc`), `docs(force): the collision README counts cells from the world origin` (`87655aa`), `fix(space): the initial rescale and the deprecation notice follow the resolved spaceSize, not the key` (`04c4eb1`), `docs: the step bound, the resolved spaceSize and the all-pairs tier are described as they run` (`d8e0bb6`)

## Why

`spaceSize` was documented as the simulation space, but `update-position.frag` clamped
every position into `[0, spaceSize]` after every force sub-step. While a layout's natural
size fits inside that square, nobody notices. Once it doesn't, the square stops being a
coordinate system and becomes a wall: the layout piles up along the border and takes the
border's square shape. On the stock config (`spaceSize` 4096, gravity 0.25) that starts at
about 105k points.

Users could move the wall only so far. Any `spaceSize` at or above the WebGL texture
size limit was reduced to half that limit, with a console warning. That cap dates from
when the many-body grid's finest level was a `spaceSize`-wide texture, which crashed iOS
(#203). Raising the value below the cap didn't help much either: both spatial grids were
laid over `[0, spaceSize]`, so a bigger space gave the same layout fewer cells and less
accuracy (see the fidelity table below).

The goal: the graph's size, not a config constant, decides how large a layout gets.
`spaceSize` keeps its name, its 4096 default and its job of setting the initial framing,
so every existing graph whose `spaceSize` is below the device's texture size limit frames
exactly as before. (One at or above it ran at half that limit and now runs as configured;
see [what an app may now observe](#not-breaking--what-an-app-may-now-observe).) It no
longer bounds any position. The change is **non-breaking**.

A week later the key was marked `@deprecated` (`3a0dae6`): once nothing is sized by it,
what is left is a world origin and a few tuned lengths that happened to be written as
multiples of it, and the next major can retire the key and put the origin at (0, 0). See
[the key, deprecated](#the-key-deprecated).

## The wall, measured

The first commit measured the problem before anything was changed: a Storybook story
plus a real-GPU harness. Setup: untouched `main` (`68f1803`), a blob start of radius
0.05·`spaceSize`, `simulationDecay` held high, 600 steps, Apple M3 Max on ANGLE Metal.

| points | gravity | at the wall | extent | predicted 2√(40n) | shape (0.707 square … 1.0 disk) |
|---|---|---|---|---|---|
| 10k | 0.25 | 0.00% | 1,272 | 1,265 | 0.991 |
| 100k | 0.25 | 0.00% | 4,044 | 4,000 | 0.987 |
| 300k | 0.25 | 58.50% | 4,096 (saturated) | 6,928 | 0.707 |
| 100k | 0 | 95.30% | 4,096 (saturated) | 4,000 | 0.707 |

At default gravity the settled extent follows 2·√(40n), which reaches 4,096 at about
105k points. 100k fits with roughly 1% to spare, and that is luck, not design. At 300k more
than half the graph sits on the border, and the layout comes out square. Gravity is a
radial spring working against repulsion, so the natural result is a disk. "Shape" is the
ratio of the 99.5th-percentile Chebyshev and Euclidean radii. (Read through the story's
own buttons, 100k settled at 4,042.)

## One name, five jobs

Going through every consumer showed that `spaceSize` was doing several unrelated jobs.
Only the bound needed to go. Everything else needed its own name or its own anchor first,
so that removing the clamp would take two lines (S = `spaceSize`):

| Job | Before | Now | Commit |
|---|---|---|---|
| Centring offset for the view | each draw/pick shader computed `(2p/S − 1)·(S/screen)`, which is `(2p − S)/screen`; `Store`'s d3 scales were a slope-1 translation | `Store.worldOrigin`, `[S/2, S/2]`, set only in `adjustSpaceSize` | `02883ea` |
| Many-body grid placement | every level's cell was `S / gridSize`, counted from world zero | every level divides the live data's bounding square, reduced on the GPU each tick (since the seam fix, padded by one coarsest cell and shifted at random every tick) | `94a354a` |
| Collision grid placement | `floor(p / cell)` from world zero, over a grid covering `[0, S]` | contact-range cells counted from the world origin, unbounded, folded onto a rotated spatial hash sized by the point count | `4f04e3e`, `3315ffc` |
| Bound on positions | clamp to `[0, S]` after every sub-step | none | `fd67d37` |
| Divergence guard (undocumented) | the clamp was the only thing that contained a blown-up force | a non-finite step is dropped; a step longer than S is shortened to S | `fd67d37` |

Every commit before `fd67d37` keeps the clamp and stands on its own. Framing and settled
extents don't change until the clamp goes. The numerics change earlier: `94a354a` changes
the many-body force of every graph above 4,096 points, and `4f04e3e` the collision force
when it is on. Neither is bit-identical to the commit before it; both settle equivalently.

### The view: a world origin

In the render path `spaceSize` was never a scale. The shader formula reduces to a
translation, and one world unit has always been one CSS pixel at zoom 1. So the view
needed a rename, not a redesign. `02883ea` gives the offset its own name so the remaining
uses of `spaceSize` are visibly the bound:

- The eight NDC shaders (plus `draw-highlighted.frag`, which declares the same block) take
  `vec2 worldOrigin` in the std140 slot `float spaceSize` used to occupy. Member order and
  offsets were checked against the driver for every program.
- `Store.scaleX/scaleY` are computed live from the origin and the screen size, replacing d3
  scales that were baked when `updateScreenSize` ran. The new form is exact where d3
  rounded. It also fixes a headless instance whose `spaceToScreenPosition` kept the old
  origin after a `spaceSize` change while the shaders used the new one.
- `setViewTransform`'s JSDoc formula and the deck.gl layer's inverse of it are now written
  in terms of the origin. The layer reads the engine's origin instead of
  `config.spaceSize / 2`. The two disagreed whenever the engine adjusted the value (an
  invalid value, or the old WebGL cap).
- Gravity pulls toward `worldOrigin`. This is only a rename: gravity is still a linear
  spring to a fixed point, not to the centroid.

### The many-body grid follows the data

The grid's *resolution* has depended on the point count since #240 (about 2·√n cells per
axis, floored at 8 and capped at 512). Its *placement* was still fixed to `[0, spaceSize]`.
A layout covering a fraction `f` of each axis lands in `(f·R)²` cells. As `f` shrinks, the
near field's sampling slots saturate, and gravity shrinks every layout for the whole run.
Points outside the space were binned into edge cells, which was harmless only while the
clamp kept them inside. `94a354a`:

- **`Shared/data-bounds.ts` (`DataBounds`)** reduces positions to their bounding box in
  three GPU passes: 64×64 partial boxes, then 8×8, then a single rgba32float texel
  `[originX, originY, extent, 1/extent]`. The box is squared, unpadded, and floored at the
  caller's `minExtent`. (The many-body force later asked for a padded box at a random offset
  every tick, to remove a seam: `history/2026/2026-10-15-many-body-grid-seams.md`.) Nothing is read back, because a readback would stall the pipeline
  every tick. Absent points are skipped by their exit flag, and non-finite positions by a
  test on their exponent bits, which a fast-math compiler can't fold away, so one diverged
  point can't set the cell size for the whole graph.
- **`ForceManyBody/grid-cell.ts`** holds the single cell formula,
  `floor((p − origin) · (invExtent · N))`, which is spliced into all four pyramid shaders
  (`calculate-level.vert`, `force-level.frag`, `force-nearfield.frag`,
  `build-nearfield-slots.vert`). Covering each point exactly once requires all four to agree
  cell for cell. So the formula uses only correctly rounded operations, with the reciprocal
  taken once and shared through the texel, and a power-of-two `N` keeps the halving between
  levels exact. It throws if one of its names collides with a host shader's `#define`,
  because the preprocessor rewrites macros inside injected code too.
- **The near-field kick bound stays a fixed length**, `2·S / finestGridSize(n)`, the same
  value it had before. It now comes from one helper, `getMaxStep`, shared with the
  all-pairs path (n ≤ 4096), so the dynamics stay continuous across that threshold. Tying
  the bound to this tick's cell would tighten it as a layout contracts, throttling the
  kicks that break dense clumps apart.

### The collision hash counts cells from the world origin

With the clamp gone, every point outside the space would land in an edge cell of the
collision grid, which was laid over `[0, S]`. The force compared a point with the centroids
of neighbouring cells and only fired when `dist < combinedRadius`; a cell holding a whole
cluster reported its own average and never fired, so the force stopped working entirely,
and nothing on screen showed it. `4f04e3e` replaced the finite grid with a spatial hash:

- The cell is the contact range floored at 8 units, `max(2r, 8)`, and is never refitted
  to the layout, however large the layout gets.
- The cell index is an unbounded integer, wrapped onto the hash texture
  (`ForceCollision/collision-grid.ts`). Each axis is rotated by a quadratic of the cell's
  block along the other axis plus a per-tick seed, so the distant cells that share a texel
  change from pass to pass.
- Both programs use one shared, division-free cell formula, so the vertex and fragment
  shaders bin bit-identically.
- That commit counted cells from the data's origin, read from a `DataBounds` reduction of
  the collision force's own, because its grid accumulated positions relative to the box
  centre for the precision of the sums.

The slot path stacked on top of it (`fix(force): stack unbounded space on pairwise
collision constraints`, `603af81`) keeps the contact-range cell, the unbounded index and the
rotated hash, but lists real points per texel by depth peeling instead of accumulating, and
checks every candidate against the queried world cell before a pair is resolved, so aliases
cost sampling slots and never a phantom push. That left the box with one reader, the
origin: its extent fed a function no shader called, and the reduction ran once per
collision iteration over the texture the many-body force had just reduced.

`3315ffc` counts cells from the world origin, `Store.worldOrigin`, bound as a uniform in
both collision programs, and deletes the collision force's reducer, bounds texture, extent
floor, `collisionLocal` and the four offset lattices. The cell formula is one subtraction,
one multiplication and one floor, the same bits in both programs. Far from the origin the
index's rounding grows with the distance, d · 2⁻²⁴ per cell, but a float32 position's own
resolution there is at least d · 2⁻²³, so a fixed anchor loses only contacts a position
cannot hold. Nothing about the layout is measured before a collision pass. Measured on
SwiftShader (a CPU rasterizer, so only the ratio carries over), collision-only steps at
100,000 points with four iterations went from 377 to 320 ms, about 15 % less; with one
iteration, at 20,000 or 100,000 points, the difference is within the run-to-run noise.

### The clamp becomes a step bound

`fd67d37` deletes the clamp. The replacement bounds the *length* of a sub-step, not the
position a point lands on:

- **A non-finite velocity is dropped**, and the point does not move that sub-step. A NaN
  has no direction, and integrating one would leave the position non-finite permanently,
  and through the many-body and collision sums, every other point's forces too. This check
  is the divergence guard. Like the bounds pass, it reads exponent bits.
- **A step longer than `maxStep` (= `spaceSize`) is shortened to it** and keeps its
  direction. This is the per-axis ceiling the clamp implied; a diagonal step at it is √2
  longer and is shortened, a step no settling layout takes. It is not a stability
  bound, since a 4096-unit step contains nothing; it only limits how far one runaway
  sub-step throws a point. Only steps whose largest component exceeds half of `maxStep`
  take the new path, so every step of a settling layout moves points by exactly the same
  bits as before.
- **Every present position on the GPU starts finite.** An infinite input coordinate lands
  on the matching edge of the space when it is uploaded (`toFiniteCoordinate`: `0` or
  `spaceSize`), and the same applies to `setPointPosition` / `setPointPositionsByIndices`.
  With the simulation on, the clamp used to absorb an infinite input on the first tick.
  With it off (`enableSimulation: false`, or a paused graph), no tick ran, so the point
  stayed at infinity: `getPointPositions()` returned it and `fitView` skipped it. It is now
  drawn on the space's edge and included in fits. A NaN target in a sparse
  write is skipped, because a sparse write can't remove a point. A non-finite
  `simulationFriction` runs at the default instead of making every step NaN.
- `Store.adjustSpaceSize` no longer cuts a value at or above the texture size limit to half
  that limit, and has dropped its `webglMaxTextureSize` parameter. `setWebGLMaxTextureSize`
  stays, because the atlas uses it. Nothing is sized by `spaceSize` any more: the many-body
  grid's resolution has followed the point count since #240, and the collision grid (sized
  from `spaceSize` and capped at 512² until `4f04e3e`) is a hash sized by the point count. Above
  2^21 the engine logs a warning but uses the value as given (see
  [the float32 ceiling](#the-float32-ceiling)). What this moves for a configuration that
  used to be cut is listed under
  [what an app may now observe](#not-breaking--what-an-app-may-now-observe).
- Custom cluster positions now carry an explicit has-position flag. Before, a negative
  coordinate read as "unset", because the sign doubled as the sentinel. Without a clamp,
  a cluster left of the space is as valid as one to its right.
- `config.ts` and `variables.ts` now describe what `spaceSize` actually does. It places the
  world origin, which is the screen centre at the initial view and gravity's attractor. It
  is the square `rescalePositions` measures against. It sets the per-sub-step displacement
  ceiling and the many-body kick bound. It bounds no position. (Since `3a0dae6` the JSDoc
  is an `@deprecated` paragraph saying the same in fewer words; `d8e0bb6` trims the
  configuration page's cell to the same rule, states the default without its texture-size
  history, and corrects the texts that still said the integrator clamps to the space, that
  the precise shell costs nothing below 25,000 points — a few percent, measured — and the
  Steady-State Motion label that called the 4,096-point pane "auto · precise" when it runs
  all pairs.)
- The Space Size Wall story now counts points *beyond* the space instead of on its border,
  and gains a "fit layout" button next to "fit space", because those two views are no
  longer the same.

### The zoom floor

`e572df5` lowers `scaleExtent` from `[0.001, Infinity]` to `[1e-6, Infinity]`. At slope 1,
fitting a span `W` into width `w` at padding `p` needs a scale of `w(1 − 2p)/W`. On a
1000px viewport that drops below 0.001 above roughly 800k units, and `fitView` then came up
short with no error. The clamp kept anyone from reaching that limit, and removing the clamp
makes it reachable. 1e-6 frames about 8e8 units, three orders of magnitude past where
float32 positions stop resolving a layout, so the floor is never what limits a fit.

d3-zoom has one extent, so the lower floor applies to every zoom, not only fits: wheel,
pinch and double-click gestures, `setZoomLevel` and `initialZoomLevel` can now go down to
1e-6, where they used to stop at 0.001. Keeping gestures at 0.001 while fits go lower would
snap a deep fit back to 0.001 on the next wheel event, so the one extent is lowered
everywhere.

### The key, deprecated

With the wall gone, `spaceSize` still reached the engine through one validated copy,
`Store.adjustedSpaceSize`, and five things were derived from it under a name that
promised a size. `3a0dae6` is step one of the retirement proposed on the PR (comment
6311708386): name each job, deprecate the key, change no layout. Step two — the origin at
(0, 0), the key removed, a migration shift of `spaceSize / 2` — is a breaking change and
waits for a major.

| Job | Source in 3.x | In the major |
|---|---|---|
| The world origin | `Store.worldOrigin`, `spaceSize / 2`, the only thing the key really sets | the constant (0, 0) |
| The per-sub-step displacement ceiling | `Store.stepGuard`, 4,096 at the default | frozen at 4,096 |
| The many-body kick span, divided by the finest grid size for the point count | `Store.kickSpan`, 8,192 at the default | frozen at 8,192 |
| Where an infinite input coordinate lands | `Store.infiniteInputEdge`, 4,096 at the default | the origin, or absent with a warning |
| The initial rescale's cutoff, density threshold and two target sides | named inside the rescale (`rescaleCutoff`, `densePointCount`, `sparseTarget`, `denseTarget`), fractions of `Store.referenceLength` since `04c4eb1` (of the raw key until then), centred on `store.worldOrigin` | constants, until a retune derives the start size from the point count |

The three lengths sit behind `Store.referenceLength` (public since `ce52f82`): the validated `spaceSize`
in 3.x, so a config that sets the key behaves as it did, and a constant in the major, when
they freeze together. Nothing outside the Store can ask for a "space size" any more; the
deck.gl layer reads the origin, probes deck's scale with a local constant (deck's Mercator
round trip is linear along the east axis, and the north probe only supplies a sign), and
keeps the config key only for its unseeded placement square.

A non-default value logs one warning per graph and per change, worded as the JSDoc is:
the key bounds nothing, it places the origin and scales the initial rescale and a few
step bounds, leave it at the default. The default set explicitly, as the stories' helper
does, says nothing. Since `04c4eb1` the notice follows validation and names the value the
engine runs at: an unusable value (0, negative, non-finite) is resolved to the default by
its own console error and is not deprecated at all, and a value below 2 is deprecated as
2. Before, it fired first and named the configured value — "spaceSize (0) is deprecated …
places the world origin at spaceSize / 2" next to "Invalid spaceSize value: 0. Using
default". The same commit makes the rescale read the resolved length: it took its cutoff
and targets from the raw key and its centre from the origin, two resolutions of one
value, so a config of 0 skipped the rescale altogether (its `!spaceSize` return) while
the origin went to the default's centre. The warning gives no migration formula, because
where the origin lands is the major's decision. A warn-once set was considered and dropped: module state
that hides the warning for the next graph on a page and leaks across tests. The
teaching examples (README, welcome, quick start, API reference, the deck.gl guide) no
longer set the key; the stories that use 4,096 for their own geometry pass the default
and stay silent.

Two findings from the same review say why the origin should move, and they are the
argument for step two:

- **0..1 input renders on a lattice when zoomed in** with `rescalePositions: false` and
  the simulation off. Every draw shader subtracts the origin in float32, and at 2,048 the
  float32 step is 2⁻¹² ≈ 2.4e-4 units: 2,000 points spanning 2e-4 units collapse onto two
  screen positions, with errors of 0.2 px at zoom 1e3, 2.6 px at 1e4 and 37 px at 1e5
  (the shader arithmetic replayed in float64/float32 with the repo's gl-matrix). With the
  origin at 0 every point is distinct and the error stays at 0.1 px. It is the mechanism
  behind deck.gl's issue 647 (icons thrashing at high zoom), whose durable fix was
  projecting relative to the viewport centre; for data near 0 an origin at 0 is the same
  fix with no shader work. Today the only workaround is `spaceSize: 2`, an origin of (1, 1).
- **0..1 input flies in from the corner** with the simulation on and no rescale: only
  gravity knows where the origin is (repulsion, links and the centre force are
  translation-invariant), so the cloud drifts about 2,900 units to (2048, 2048) at some
  70 units per tick before it settles. With the origin at 0 it starts where it is.

A camera-relative anchor (the matrix built in float64 around the world position at the
screen centre, the shaders subtracting that anchor) would be the general fix for data at
any magnitude; it is a later follow-up, and it cannot go beyond the input's own float32
step, since `setPointPositions` takes a `Float32Array`.

## Results

All numbers are from the real GPU (Apple M3 Max, ANGLE Metal, headless Chromium), with a
fixed seed. Runs are bit-deterministic.

### Many-body fidelity vs occupancy

The grid force was compared against an exact float64 all-pairs sum. Setup: 100k points
(finest grid 512, 8 near-field slots), 20 trials, 1,500 query points, a uniform square of
side `f·spaceSize`. The harness reproduces the all-pairs path to 0.0001%. "Occupancy" is
points per finest cell as the space-anchored grid saw them.

| f | occupancy | per-tick error, before | trial-mean error, before | error, after |
|---|---|---|---|---|
| 1.0 | 0.38 | 0.060% | 0.060% | 0.060% |
| 0.5 | 1.53 | 0.060% | 0.057% | 0.057% |
| 0.25 | 6.10 | 0.354% | 0.089% | 0.057% |
| 0.18 | 11.8 | 0.868% | 0.400% | 0.056% |
| 0.1 | 38.1 | 1.840% | 0.515% | 0.057% |

Before, most of the per-tick error at small `f` was sampling variance from saturated
near-field slots, and the bias grew as well. After, the per-tick and trial-mean errors
match to the digits shown, and both are flat in `f`. Results were the same at alpha 0.01,
so the near-field step bound is not what caused the degradation. Other layouts:

- 20k points, f = 1 / 0.5 / 0.25 / 0.18 / 0.1: before 0.107 / 0.107 / 0.112 / 0.353 /
  0.317%, after 0.108 / 0.109 / 0.114 / 0.117 / 0.107%.
- 100k-point disk: before 0.235% → 2.035% across the same range, after flat at about 0.23%.

### Translation invariance

Setup: the same 20k-point blob (radius 250, gravity 0, 30 steps, staying inside the space)
placed at two offsets. The table gives the final difference as a fraction of the extent.

| offset | before | after |
|---|---|---|
| centred at (2900, 2750) vs (1200, 1300) | 0.0248% | 0.00091% |
| nudged by (+3.37, +1.71) | 0.0109% | 0.00013% |

The float32 noise floor of the configuration, measured on the all-pairs path (3,000
points, 200 steps), is 0.00015%.

### Collision outside the space

Setup: 800 overlapping points of size 12, collision only, starting from a 120-unit square,
200 steps. Each cell gives final extent (overlapping pairs). The middle column is the
previous many-body commit with only the clamp lines deleted. It shows why the collision
work had to land before the clamp could go.

| cluster centre | clamp deleted, hash still anchored to the space | after |
|---|---|---|
| (2048, 2048) | 245.7 (2,745) | 246.5 (2,759) |
| (1000, 3100) | 244.6 (2,721) | 248.9 (2,755) |
| (20000, 20000) | 119.7 (7,537) | 246.4 (2,708) |
| (−9000, −9000) | 119.7 (7,535) | 248.6 (2,775) |
| (1e5, −3e5) | 119.7 (7,539) | 242.7 (2,734) |

On `main`, with the clamp still in place, the cluster at 20,000 or −9,000 isn't resolved at
all. The clamp collapses it into the corner of the space (extent 3.9, about 155k
overlapping pairs). Inside the space, `main` matches the first row (245.7). One point
200,000 units away no longer changes how a cluster resolves.

The table is the centroid hash's (`4f04e3e`), at 800 points — a count the slot path serves
with the exact all-pairs shader. The slot path's own figures, at 4,200 points on SwiftShader
(`797eddf`): the same cluster, one pass after a move to (1000, 3100) or (2900.37, 1500.71),
differs from its layout at the centre by 1.3e-6 and 1.9e-6 of its extent; three copies
across 8,000 units, more cells than the hash has texels, spread to 376.0, 374.5 and 374.7
from 224; with one point 7,400 units away a cluster spreads to 512.2 with 15,374
overlapping pairs, against 509.9 and 15,350 alone.

### Large layouts, after

Same harness and setup as [the wall](#the-wall-measured):

| points | gravity | beyond the space | extent | shape |
|---|---|---|---|---|
| 10k | 0.25 | 0% | 1,272 | 0.991 |
| 100k | 0.25 | 0% | 4,044 | 0.986 |
| 300k | 0.25 | 56.57% | 7,012 (2√(40n) = 6,928, ratio 1.012) | 0.986 (was 0.707) |
| 100k | 0 | 94.82% | 20,234 and still growing | 0.986 |

The 300k extent by step: 50: 6,664 · 100: 6,973 · 150: 7,007 · 200: 7,011, then
7,011–7,012 through step 600. The 100k run without gravity grows steadily: 8,333 at step
100, 20,234 at step 600. No run produced a non-finite position.

### What did not change

- `02883ea`: positions after 300–500 steps are bit-identical to `main` across six force
  mixes, and so are every rect, polygon, hover and sampled pick and every space↔screen
  conversion. Static renders are bit-identical under exact IEEE arithmetic (SwiftShader,
  which CI runs). On Metal, 48–119 of 800,000 link anti-aliasing pixels per view differ by
  one level, because the compiler re-associates the new translation differently. At a
  non-power-of-two `spaceSize` the old form rounded twice and the new one rounds once, so
  edges can move by less than a pixel there.
- `e572df5`: positions, picks, conversions and renders are identical to the previous commit.
- `94a354a`: the all-pairs path, renders and picks are bit-identical. Grid-path layouts
  settle where they did (100k at 4,044, 10k at 1,272), except that one starting from a very
  tight blob can settle into a different arrangement (see [Still open](#still-open)).
- `4f04e3e`: only the collision scenario changes. Every other simulation, render and pick
  is bit-identical.
- `fd67d37`: against the previous commit, the only scenarios that change are the two that
  touched the border: a grid-path layout without gravity (0..4,096 becomes
  −2,089..6,188) and a start outside the space. A sweep of 16 stories: 13 are bit-identical
  and Space Size Wall changes only its readout text. Labels and lasso selection start from a
  tight blob, and their first-tick burst now overshoots past the space (36% and 78% of
  points at step 1, none by step 3) instead of piling on its edge. They settle to the same
  clusters, with final extents 1,241.5 → 1,274.5 and 2,171.6 → 2,177.1, and no non-finite
  positions.

### Cost

| What | Cost |
|---|---|
| Many-body bounds reduction | 0.16 ms per tick from 5k to 300k points; 0.22 ms at 1M and 0.45 ms at 2M, with the first pass at 128² above 262,144 points (0.58 ms and 1.28 ms at 64²) |
| Many-body step time, paired interleaved A/B against the commit before (blob, gravity 0.25, after 60 warm-up steps) | 5k +0.05 ms (+1.5%) · 8k +0.035 ms (+1.1%) · 20k −0.44 ms (−15%, not investigated) · 100k −0.03 ms (−0.4%) · 300k +0.28 ms (+1.3%) |
| Collision, when on | a fixed ~0.3 ms per step: +9–13% at 5k–20k points, +2–3% at 100k, over 50% for a few hundred points. Nothing when off |
| Step bound (clamp → step-length bound), paired interleaved A/B against the commit before, 13 rounds | 100k: −0.01 ms (6.815 → 6.800 ms per step), where both versions run the same layout — nothing measurable. At 300k the step is 2.3 ms faster (21.43 → 19.16 ms), but there the layouts differ (the old one piled on the border), so that is not the shader's cost |

## Where the work departed from the plan

The work followed a staged plan. It departed from the plan in the places below, each time
on measurement:

- **No padding around the data box** (the plan said about 6%). Halving between levels is
  exact without padding, and a margin leaves the layout's edge mid-cell on every level.
  Error rose from 0.060% to 0.124% on a square layout and from 0.23% to 0.31% on a disk.
  Reversed for the many-body grid the next day: a one-coarsest-cell pad at a random offset
  every tick removes the grid's centre-line seam, and with the pyramid starting at 8² it
  costs less than this fixed margin did (`history/2026/2026-10-15-many-body-grid-seams.md`).
- **A floor of 0.25 units per finest cell, not 1.** The floor only has to keep one point,
  or a coincident stack, indexable. At 1 unit it kicked in at ordinary densities: a
  100k-point square a tenth of the space wide (mean spacing 1.3 units) went from 0.06% to
  0.30% error.
- **A third reduction pass** (64² → 8² → 1, where the plan had two). With two passes, one
  fragment folding 4,096 partial boxes cost about 0.8 ms per tick (+12% at 100k). With the
  middle pass the whole reduction costs 0.16 ms. The texel also carries `1/extent`, so every
  shader scales by the same bits instead of dividing on its own.
- **Collision never widens its cell; the grid became a rotated spatial hash.** The plan
  said to widen the cell when a fixed cell count could not cover the layout. That was built
  and rejected in review. With 500 overlapping clusters plus one point 7,000 units away, it
  ended at 50,206 overlapping / 33,621 deep pairs, from 75,930 / 19,865 at the start: more
  deep overlaps than it began with, so worse than no collision at all. A cell wider than
  the contact range turns its centroid into a wrong push. The final design ends that
  scenario at 31,622 / 6,573, about where the run without the outlier ends (31,307 /
  6,548); at box sizes from 5,120 to 1e5 it ends with 6,166–6,584 deep pairs. A plain
  modulo hash was rejected too, for two reasons. It produced phantom pushes: a point midway
  between two others two grid widths apart was pushed 5.4 units. It also hid the same
  points permanently: Gaussian clusters spread over 9,000 units ended with 52,408 deep
  pairs against 388 on an unshared grid. The rotated hash gives 477. Wider
  than the alias-free span it resolves more slowly: Gaussian cluster fields 9,000–30,000
  units wide keep 10–71% more overlapping pairs than an unshared 4096² grid after 600
  steps. Nothing ends worse than it started. These figures are the centroid hash's
  (`4f04e3e`); the slot path keeps the contact-range cell and the rotated hash, and its own
  figures are under [Collision outside the space](#collision-outside-the-space).
- **The step bound is not the plan's `if (!(speed <= maxStep))`.** The finiteness test
  reads exponent bits. ANGLE's Metal backend compiles with fast math, which may assume
  there are no NaNs and fold a comparison away. The length is computed from a direction
  scaled by the largest component, so a huge but finite velocity keeps its direction
  instead of overflowing `length()`. A 38-case injection test (NaN payloads, ±Infinity,
  denormals, `FLT_MAX`, lengths that overflow float32) at `spaceSize` 4096 and 1e7 left
  every position finite on both Metal and SwiftShader.
- **±Infinity input, NaN sparse writes, non-finite friction, negative cluster positions**
  (all described above). The plan didn't list them. They came up in review once nothing
  pulled positions back into the space any more.
- **The collision gate's numbers.** The plan's "120 → 1,396 units" came from an older
  collision force. On current `main` the scenario that tells the designs apart is size 12,
  and it spreads to about 246 units.

## The float32 ceiling

Positions are float32, and the force kernel's length scale is its 1-unit `distanceMin`.
The gap between neighbouring float32 values (ULP), relative to that 1 unit, at
coordinates of:

| coordinate | ULP | ULP / `distanceMin` |
|---|---|---|
| 4,096 | 2⁻¹¹ | 0.05% |
| 65,536 | 2⁻⁷ | 0.78% |
| 1e6 | 2⁻⁴ | 6.3% |
| 8.4e6 (2²³) | 1 | 100% |

The practical ceiling is about 1e6 units. It is **documented, not enforced**: in the
`spaceSize` JSDoc, and through a console warning when `spaceSize` exceeds
`MAX_RESOLVED_SPACE_SIZE` = 2²¹ (a world origin of about 1e6, where the ULP is 1/8 unit).
Past the ceiling, layouts freeze onto a coarse lattice. At `spaceSize` 1e7 the lattice is
0.5 units, and at 1e9 the layout stopped at an extent of 88,896. The zoom floor frames well
past this ceiling.

## Not breaking — what an app may now observe

No public API was removed or renamed. `spaceSize` keeps its name and default, and the world
origin is `spaceSize / 2` as before, so every existing graph whose `spaceSize` is below the
device's texture size limit frames as it did. `adjustSpaceSize`'s dropped parameter is
internal to `Store`. No API ever promised that positions stay inside `[0, spaceSize]`.

The one configuration that now lays out differently is a `spaceSize` at or above the
texture limit (the first bullet below). `migration-notes.md` has no entry for it: what
`main` did there depended on the device, was announced at runtime as an override, and was
inconsistent with itself. What an app can now see:

- **A `spaceSize` at or above the device's maximum texture size** used to run as half that
  limit, with a console warning. The limit is 16,384 on most desktop GPUs and 8,192 under
  SwiftShader (headless CI). On a GPU whose limit is 4,096 even the default was cut. Such a
  `spaceSize` now runs as configured. The world origin, and with it the centre of the
  initial view and gravity's attractor, moves from a quarter of the limit to
  `spaceSize / 2`. The displacement ceiling and the many-body kick bound grow with it. With
  gravity on, a layout placed around the old origin is pulled to the new one instead, and
  drifts out of a view fitted while it was still there (`fitViewOnInit`'s, for one). A
  value above 2²¹, which used to run as half the limit, now coarsens onto the float32
  lattice or freezes, with a new warning. To keep a layout placed for the old value, set
  `spaceSize` to the value the old warning reported. On `main` these configurations also
  disagreed with themselves: `rescalePositions` and the deck.gl layer used the configured
  value while the simulation used the cut one, so rescaled input started around
  `spaceSize / 2` and slid toward the cut origin. That case now stays where it starts.
- `getPointPositions()` / `getPointPositionsArray()` may return coordinates outside
  `[0, spaceSize]`, negative ones included, once a layout outgrows the space or starts
  outside it.
- The deck.gl layer's `getBounds()` returns the box of the live point positions (the input
  positions before the first load), and the space's square only when there is nothing to
  measure. Since `f7ad83f` the read never stalls: the box is served from a cache and
  refreshed by one asynchronous read at a time when the positions changed since it was
  measured, and the layer asks for a redraw when the read lands, so deck's mask and
  collision-filter effects can read it every frame. While points move it trails the drawn
  frame by about one; before the first read lands the call returns the input box.
- Since `ce52f82` the world origin, the step guard and the infinite-input edge are resolved
  when the graph is constructed, not when its device arrives, and `Store.referenceLength`
  exposes the validated length. `spaceToScreenPosition` and the deck layer's `getBounds()`
  give the configured origin before `ready`, where they gave the default's; the layer
  places unseeded points and the infinite-input edge by the engine's validated length,
  so an invalid `spaceSize` runs at the default on both sides.
- The zoom-out floor is 1e-6 for every zoom, not only fits. Wheel, pinch, double-click,
  `setZoomLevel` and `initialZoomLevel` can go below the old 0.001, and `getZoomLevel()` and
  `onZoom`'s transform can report such scales. A fit against an unmeasured (zero-width)
  container, which already collapsed to the floor, now collapses to 1e-6, and zooming back
  in from it with the wheel takes about twice as many notches.
- With the simulation off, a point given an infinite coordinate is placed on the space's
  edge, drawn there and included in fits. It used to stay at infinity: `getPointPositions()`
  returned it and `fitView` skipped it.
- A dense rescaled input (more than 0.001·`spaceSize`² points, laid out at
  1.2·`spaceSize`) keeps its outer band instead of having it clamped onto the edge on the
  first tick.
- A configuration that keeps diverging no longer piles up on the walls; it runs away. With
  a link spring ≥ 10 and decay held, that was about 8,190 units per tick, with no NaN.
- A graph above 4,096 points that starts from a very tight blob gets a much stronger first
  tick (see [Still open](#still-open)). It can overshoot past the space for up to two ticks,
  and it settles to a similar extent but not always into the same arrangement: against
  `main`, the Radial Mesh, Worm and Actions stories fold differently and Lasso Selection
  orders its clusters differently.
- A custom cluster position with a negative coordinate is now honoured instead of falling
  back to the cluster's centre of mass.
- Since `3a0dae6`, a config that sets `spaceSize` to anything but 4096 logs one
  deprecation warning per graph and per change. TypeScript marks the key `@deprecated`.
  Nothing else changes for such a config, with two already-warned corners: a rescale under
  an invalid (≤ 0, non-finite) or sub-minimum (< 2) `spaceSize` follows the value the
  engine runs at. Since `04c4eb1` that is the whole rescale, not only its centre: an
  invalid value used to skip the rescale (points stayed as given, at the raw scale, while
  the origin went to (2048, 2048)) and now rescales exactly as the default does; a value
  below 2 rescales as 2, centred on (1, 1). The deprecation notice for an invalid value is
  gone — the error that resolves it says everything.

## Verification

- `pnpm test` (SwiftShader, as in CI) grew from 6 files / 124 tests to 7 / 154. The new
  `test/unbounded-space.test.ts` covers the following:
  - fitting a two-million-unit layout (fails on the old zoom floor: stuck at 0.001 against
    the 1.2e-4 needed)
  - the data box: squared, floored, single point, all absent
  - the same blob laid out alike, to float rounding, wherever it sits, and a coincident
    stack spreading
  - the collision hash, at 4,200 points so the slot path runs (`797eddf`; at 100–1,200
    points these tests had run the exact all-pairs shader): same result at any offset,
    contact-range cell, three copies wider than the hash, a cluster far outside the space,
    and one point 7,400 or 200,000 units away
  - both collision programs binning alike, probed with 8,450 points planted on cell
    boundaries as overlapping pairs that must all be pushed apart (`e8d24d4`). An isolated
    point cannot see a disagreement on the slot path — a mis-binned point is skipped by
    index and missed by its neighbours, never pushed by itself — and the probe fails with
    3,292 points left standing when the contact pass scales by 1.000001 more than the peel
  - positions persisting outside the space, and a layout growing past it
  - a `spaceSize` above the texture limit taken as given, and the 2²¹ warning
  - the step bound by injection, infinite input coordinates on both upload paths,
    non-finite friction, and negative cluster positions

  `test/deck-layers.test.ts` checks `getBounds()` against live positions, input and the
  fallback, that it reads asynchronously, once per change and never through the synchronous
  read, and that a provided graph's own `spaceSize` is reported before its device arrives. `test/host-embedding.test.ts` checks that space → screen stays an exact
  translation by the live origin through a `spaceSize` change.
- `3a0dae6` adds a deprecation test: the default set explicitly at construction is silent,
  a switch to 2048 warns once, a switch back to the default is silent, and a graph built
  with 1000 warns at construction. The two existing no-warning assertions ignore the
  deprecation line. The rescale's centring term is written `centre − side / 2`,
  parenthesised: rounding commutes with doubling, so it is the same bits as the
  `(2·centre − side) / 2` it replaced, and default layouts stay bit-identical (unparenthesised
  it would add to the padding term first, which differs in one double in eight). 189 tests.
- `04c4eb1` adds two tests, both failing before it: a graph at `spaceSize: 0` rescales to
  the same positions as one at the default (it stayed unscaled), and one at 1 as at 2; the
  notice stays silent for 0 next to its error, and names 2 for 1.
- Large-scale numbers (100k–1M) come from the real-GPU harness and are reported here, not
  committed as tests.

## Example

- **Space Size Wall** (`src/stories/performance/space-wall.ts`, Storybook *Examples /
  Performance*, tags `perf`, `advanced`, `large-data`): a seeded blob of 10k, 100k or 300k
  points at gravity 0 or 0.25. The `spaceSize` square is drawn as a DOM overlay through
  `spaceToScreenPosition`, and points beyond it are painted red. The readout shows the share
  of points beyond the space, the extent next to the 2·√(40n) it settles at, extent ÷
  `spaceSize`, and the non-finite count. "step ×200" advances the simulation even where
  `requestAnimationFrame` never fires (hidden tabs, automated preview panes). "fit space" and
  "fit layout" show that framing the space and framing the graph are no longer the same. On
  `main` it showed 300k points piled square against the border; it now shows them settling
  into a disk about 7,000 units across.

## Still open

- **Only Apple GPUs were measured**: an M3 Max on ANGLE Metal, plus SwiftShader in CI.
  NVIDIA, AMD and Intel, ANGLE's D3D backend, and mobile GPUs are untested. The binning
  agreement and the exponent-bit tests are designed for them but haven't been run there.
- **Collision costs a fixed ~0.3 ms per step** when on. That is over 50% of a step for a
  few hundred points.
- **One far but finite point stretches the many-body box** and coarsens the grid for every
  point. With a 100k blob plus one point at 1e7, the blob settled at extent 1,201 instead of
  4,044 while the point stayed out there. Gravity brings such a point back at most
  `spaceSize` per tick, and never does with gravity 0 or a pinned point. At 1e5 there is no
  visible effect. Step time in those review runs also rose, from 6.8 ms to 42.8 ms (point
  at 1e6) and 72.1 ms (point at 1e7). Not investigated.
- **The first-tick burst from a tight start blob** is about 10× larger than on `main`
  since `94a354a`. The coarse space-anchored cells used to put a whole 41-unit blob into
  the near field, whose per-tick kick is bounded. Layouts settle to a similar extent, but
  stories that start 10k or more points from such a blob (Radial Mesh, Worm, Actions,
  Lasso Selection) settle into a different fold or arrangement than on `main`: per-point
  median differences of 9–210 units, where `main` itself differs between Metal and
  SwiftShader by 0.3–14. Bounding the first tick's far-field push is a candidate follow-up.
- **`simulationRepulsionTheta` is still a documented no-op** (out of scope here).
- **`spaceSize` still sets two length scales**: the per-sub-step displacement ceiling and
  the near-field kick bound `2·spaceSize / finestGridSize(n)`. Both are fixed values, as
  before, now named `Store.stepGuard` and `Store.kickSpan`; they follow the key in 3.x and
  freeze at their defaults in the major. Making force lengths relative to the layout was
  explicitly out of scope. Making the ceiling a config key was considered and rejected: at
  4,096 it binds nothing in a healthy layout (gravity alone reaches it only some 164,000
  units from the origin at the default strength), so as a knob it would be meaningless at
  its default and silently harmful when set low. A real per-tick displacement cap that
  anneals with alpha is a separate feature, if ever.
- **Step two of the retirement** (a major): the origin at (0, 0), the key removed with a
  migration note (shift a saved layout by `spaceSize / 2` on each axis, or run it with
  gravity 0), the three lengths frozen, the rescale targets derived from the point count
  (the settle law above gives the scale: about 2·√(40n)), an infinite input placed at the
  origin or dropped with a warning, the precision check moved to ingest. Whether it lands
  with this PR or later is the author's call.
