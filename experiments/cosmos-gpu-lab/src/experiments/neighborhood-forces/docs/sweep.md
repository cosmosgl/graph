# Repeatable parameter sweeps

The **Repeatable parameter sweep** section runs a fixed Cartesian product of parameters, independently
of the interactive demo settings. Every row starts from the same deterministic uniform position
generator, scaled for the selected density, with zero velocity. It validates a trial step before timing.

| Matrix | Point counts | Density multipliers | Radii | Grid sizes | Configurations per repetition |
| --- | --- | --- | --- | --- | --- |
| Quick | 256, 1,024 | 1, 4 | 0.04, 0.08 | 16, 64 | 16 |
| Standard | 1,024, 4,096, 16,384 | 1, 4, 16 | 0.04, 0.08, 0.16 | 16, 32, 64 | 81 |
| Large | Standard + 65,536 | 1, 4, 16 | 0.04, 0.08, 0.16 | 16, 32, 64 | 108 |

Each configuration schedules both methods; all-pairs above 4,096 is recorded as **skipped**, never as
zero time. Two repetitions are the default. Large matrices, especially dense large-radius workloads,
can take minutes. Cancellation takes effect after the current GPU submission or initialization completes.

## What density means

For multiplier D, divide the same generated coordinates by sqrt(D). Uniform positions then occupy
a square of area 4/D inside the unchanged [−1, 1]² simulation domain. Nominal populated-area density
is N×D/4 points per square unit. This separates concentration from N without changing point identities.

Cell width is always 2/gridSize; the domain and cell width do not shrink when density increases.
Consequently a denser population changes cell occupancy and neighbor work. Reports also include
occupied-cell count, maximum cell load, mean candidates and mean actual neighbors.

This uniform-compression study is different from the demo's eight-cluster and diagonal distributions.
Those remain useful manual stress tests. The boundary preset deliberately retains its exact wall
anchors even when the remaining generated points are compressed.

## Repeatability and ordering

- The point generator is fixed and deterministic; the **order seed** only shuffles configuration runs.
- The complete shuffled plan is exported. Reusing the same preset, repetition count and order seed
  reproduces that plan and the initial coordinates.
- Method order varies across configurations and reverses for the same configuration on its next repetition.
- Every method allocates independent resources, validates, calibrates its batch size, warms up twice, then records eight batches
  per stage. Allocation, upload and validation are outside measurements.
- Input buffers stay fixed during timing. Repetitions remain separate rows; no pooled “speedup” hides variance.
- Rendering uses identical detached 480×480 canvases. GPU work is measured, but compositor/presentation
  cost is not represented. Do not compare sweep wall time directly with an interactive frame rate.

The grid-size axis also repeats all-pairs measurements, even though that method does not use the grid.
This costs time but keeps each configuration's comparison self-contained.

## Running and reading a sweep

1. Start with Quick and two repetitions; keep this tab visible.
2. Observe progress and the table of per-tick GPU and amortized wall-time medians, with the tick batch size.
3. Export JSON. It contains every configuration, method order, validation status, stage samples, batch sizes and calibration results,
   timestamp pairs, discarded-sample counts and summaries, plus browser and available adapter metadata.
4. Compare matching configurations and inspect force/grid/render stages before attributing a difference.
5. Repeat on the same device and power state, then on other devices. Record those conditions externally
   if the adapter metadata does not identify them.

**Cancel sweep** preserves completed rows, as does a failed row. Export remains available during a
run and captures a snapshot of the rows recorded so far. The exported status distinguishes a running,
completed or cancelled run. Switching away from the browser tab stops the sweep at its next checkpoint
to avoid silently collecting throttled wall-time samples. Navigating to another lab page destroys the
experiment, so export partial results before navigating away.

GPU timestamps may be unavailable or quantized. A zero interval is not infinite performance, and
missing or invalid samples are not zeros. Raw timestamp values are decimal strings to preserve the
64-bit integers in JSON. See [Performance](#/neighborhood-forces/docs/performance) for exact boundaries.
