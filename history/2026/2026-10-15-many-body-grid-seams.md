<!-- suggested path: history/2026/2026-10-15-many-body-grid-seams.md -->

# Many-body grid seams: the grid shifts every tick, and the pyramid starts at 8²

**Date:** 2026-10-15
**Commits:** `perf(force): start the many-body pyramid at 8² — the 4² level was its slowest pass` (`49f83d9`), `fix(force): shift the many-body grid every tick — fixed cell boundaries drew a cross` (`e29bb10`), `docs(force): the many-body grid shifts every tick and starts at 8²` (`6c35257`)

## Why

Dense layouts above 4,096 points settled into a cross. Along each centre line of the layout
ran a thin line with fewer points, and fainter lines ran along the quarter lines. It showed
up zoomed into the **Performance → Space Size Wall** story at 300k points. It is not new:
`main` draws the same cross, more strongly, along the centre lines of the space.

The cause is the grid pyramid's split between far and near. Each level takes every cell
outside the 3×3 neighbourhood of the point's own cell as one centroid, and leaves that 3×3
to the next, finer level (`force-level.frag`). The split is decided by the point's cell. A
point that crosses a cell boundary therefore swaps two columns of cells between "one
centroid" and "refined", and the force jumps there. Each jump is small, the difference
between two approximations of the same mass. But on a fixed grid it sits at the same place
every tick, and every boundary of the coarsest level is a boundary on every finer level, so
the jumps along it add up. They add up most at the centre lines: a crossing there switches a
column of coarsest cells on both sides, while near the box's edge the 3×3 shell is clipped and
only one column switches. Near the centre lines the force points away from the line on both
sides, and points drift off it.

The pyramid tiles the box exactly once (no gaps, no double counting), and the docs called
that "seam-free". It is, for coverage. The force it produces was never continuous.

## The seam, measured

Real GPU (Apple M3 Max, ANGLE Metal, headless Chromium), a blob start, gravity 0.25,
`simulationDecay` held high, 1,500 ticks. The metric is the point density in a thin strip
on a line, divided by the density of the strips around it: 1.0 means no seam. Strips are
1/512 of the data box wide, and each line is measured along both axes.

| 300k points, `spaceSize` 8192, 2 seeds | centre lines | quarter lines | 3/8 and 5/8 lines | off-boundary control lines |
|---|---|---|---|---|
| `main` (grid on the space) | 0.788 | 1.003 | 1.008 | 1.000 |
| this branch before the fix (grid on the data, 4² start) | 0.870 | 0.971 | 0.995 | 1.004 |
| 8² start, no shift (4 seeds, `spaceSize` 4096) | 0.990 | 0.982 | 0.989 | 0.999 |
| 8² start and per-tick shift (this change) | 1.006 | 1.000 | 1.002 | 0.999 |

Standard errors are 0.002–0.006. On `main` only the centre lines show, because only they
are boundaries of the space grid that pass through the layout's middle. At 100k points
every version stays within a few percent (`main` 0.976 at the centre, this branch 0.966 at
the quarter lines, the fix 0.986–1.005), so the cross needs a dense, large layout to show.

## What changed

- **The grid shifts every tick** (`e29bb10`). `DataBounds.run()` takes an optional
  `originShift: { cellsPerAxis, offset }`. The final reduction pass pads the fitted square
  by one cell of the consumer's coarsest grid (a cell of `extent / (cellsPerAxis − 1)`) and
  slides its origin back by `offset` of that cell. The padding equals the slide's range, so
  the fitted square stays inside whatever the offset. The many-body force passes its
  coarsest grid (8) and a fresh uniform offset per axis every tick, drawn from the
  simulation's random stream (seeded by `randomSeed` when set). A uniform shift over one whole coarsest cell is also
  uniform modulo every finer cell, so every level's boundaries are spread evenly over the
  data and the jumps average into a continuous force. What is left is per-tick noise that
  alpha anneals, the same trade the Monte-Carlo near field already makes. The collision
  force owns its own `DataBounds` and passes no shift.
- **The pyramid starts at 8², not 4²** (`49f83d9`). `COARSEST_GRID_SIZE` names the
  coarsest level; the finest level is unchanged. Two reasons:
  - The shift pads by one *coarsest* cell. From 4², that is a third of the box, which
    coarsens every level's cells by 4/3. Measured that way, the 100k-point disk error rose
    from 0.22% to 0.37% and steps got 17% slower (more points per near-field cell). From
    8² the padding is a seventh.
  - The 4² level was the costliest pass. Dropping it cut step time by about a third at
    100k–300k points, and the gain grows with the point count. The most likely cause is
    blending contention: every point is drawn into each level with additive blending, and
    on a 4² level about a sixteenth of all points land on each texel. This was not
    profiled.

  The 8² start alone also improved accuracy (a 100k disk 0.224% → 0.093%) and cut the
  centre-line dip to about 1%, but it left 1–2% dips on every 8² boundary. That is why the
  shift was still needed.

## Cost and accuracy

All paired and interleaved in one page, median of 11 rounds, blob start, gravity 0.25:

| step time | 5k | 20k | 100k | 300k |
|---|---|---|---|---|
| `main` | 3.37 ms | 2.91 ms | 6.88 ms | 21.77 ms (layout on the wall) |
| before this change | 3.41 ms | 2.44 ms | 6.84 ms | 19.68 ms |
| after | 3.29 ms | 2.31 ms | 4.81 ms | 13.60 ms |

Force accuracy against an exact float64 all-pairs sum (1,500 query points, 20 trials of the
same positions; "mean" is the error of the 20-trial average, which keeps the bias and drops
most of the noise):

| layout | before, per tick (= mean) | after, per tick | after, mean |
|---|---|---|---|
| 100k square, `f` = 1 / 0.5 / 0.25 / 0.18 / 0.1 | 0.060 / 0.057 / 0.057 / 0.056 / 0.057% | 0.089–0.091% | 0.063–0.066% |
| 100k disk | 0.224% | 0.118% | 0.098% |
| 20k square | 0.108% | 0.124% | 0.061% |
| 20k disk | 0.252% | 0.145% | 0.099% |

Before the change one tick's error equalled the mean, because nothing varied between ticks
at these occupancies. After it, the shift adds per-tick noise. On a 100k uniform square, the
fitted box's best case (its outermost cell edges on the data's edge), the mean error rises
slightly (0.060% → 0.066%); on a 20k square it falls (0.108% → 0.061%), while a single tick's
error rises to 0.124%. On a disk, the shape gravity actually produces, both are about half of
what they were, and that gain is the 8² start's: against the same 8² pyramid without the
shift, the shift itself raises the 20-tick-mean error a little, 0.055% → 0.066% on the 100k
square and 0.093% → 0.098% on the 100k disk. Other effects:

- **Steady-state motion** (300k points, RMS displacement per tick at equilibrium with alpha
  held at 1, in point spacings): 0.001 → 0.0023. Invisible at any zoom that shows the layout,
  and both shrink as alpha decays.
- **Settled extents** are 0.2–0.3% smaller: 10k points 1,272 → 1,269, 100k 4,044 → 4,033,
  300k 7,011 → 6,994. About 0.1% of that is the shift's (300k: 7,003 → 6,994 against the 8²
  pyramid without it); the rest is the 8² start's.
- **The smallest finest cell** grows from 0.25 to 0.25 · 8/7 ≈ 0.29 units, because
  `MIN_FINEST_CELL_SIZE` floors the fitted square and the padding comes after it.
- **Translation invariance holds**: the shift is relative to the data, so with the same
  `randomSeed` a translated layout replays the same grid. The existing test of the same blob
  at three places still passes at float rounding, and on the real GPU two placements of a
  20k-point blob end 0.0006% of the extent apart (0.0009% before), nudged ones 0.0004%.

## Where this departs from earlier decisions

The unbounded-space work (`history/2026/2026-10-14-unbounded-space.md`) chose **no padding
around the data box**, on measurement: a fixed ~6% margin left the layout's edge mid-cell
on every level and raised the error (square 0.060% → 0.124%, disk 0.23% → 0.31%). That
margin bought nothing. This padding buys the seams' removal, and with the 8² start it costs
less than the margin did: square 0.066% and disk 0.098% for the 20-tick mean, 0.091% and
0.118% per tick.

## Alternatives not taken

- **A continuous split.** Weighting each cell's centroid by a smooth function of the
  point's position in its cell, instead of the hard 3×3 shell, would make the force
  deterministic and continuous. It needs wider neighbourhoods per level and an ancestor
  weight product, probably two to three times the far-field work. Not tried.
- **A larger coarsest level** (16²) would shrink the padding to 1/15, but the first level
  visits every cell for every point (256 instead of 64). Not tried.
- **Staggered grids** averaged per tick would halve the jump deterministically and double
  the cost. Not tried.

## Verification

- `test/unbounded-space.test.ts`: the shifted box's texel for asymmetric offsets and at
  both ends of the offset range (containment), and through the engine, that the many-body
  box moves every tick by less than one coarsest cell and always covers every point. Between
  them they were checked to fail when the force passes no shift (the engine test), when the
  shader ignores it (both), and when `DataBounds` swaps its x and y offsets (the texel test).
- The seam, accuracy and timing numbers above come from a real-GPU headless harness
  (Playwright, ANGLE Metal) comparing self-contained bundles of `main`, the commit before
  this change, and this change.

## Still open

- Measured on an Apple M3 Max (ANGLE Metal) and SwiftShader only.
- The seam metric lives in an ad-hoc harness, not in a story or a test: a dense 300k-point
  layout is too slow for SwiftShader in CI.
