## Independent repulsion trajectories

This experiment follows the [precision cost comparison](#/many-body-grid/docs/precision-cost). Each backend now
keeps its own positions between ticks. It asks whether a one-step precision improvement also limits accumulated drift,
before introducing springs, gravity and cooling.

```flow
Start together · Identical fixture, flags and random samples
Build each path's frame · Own positions and bounds, shared deterministic tick seed
Step independently · Production WebGL, full-buffer WebGPU, streamed WebGPU and CPU
Check each GPU locally · CPU recomputes the tick from that GPU's previous positions and frame
Measure drift · Compare independently evolved positions, radius and motion
Repeat · Never replace GPU positions with the CPU path
```

The GPU paths reuse the existing luma backends. The WebGL path imports production shaders; both WebGPU paths use
the refined far-field arithmetic and corrected centroids. CPU bounds and readback are intentional diagnostics,
not evidence that a fully GPU-resident production simulation is ready.

## Two different questions

**Local correctness:** given this path's input, did its GPU tick reproduce the independent CPU calculation?
The existing `2e−5 + 3e−5 × |reference|` component budget is unchanged. Every tick checks forces, positions, cell
aggregates, selected identities and integration from actual GPU forces. Corrected WebGPU also checks centroid bits.
A local failure remains a failure even when the picture looks similar. The report retains failed-tick counts and the
first failing input/output for each backend.

**Accumulated drift:** how far apart are the paths now? RMS and maximum Euclidean point displacement are compared
with the independent CPU path. Full-buffer and streamed paths are also compared directly. These values have no
invented quality threshold; a trajectory can drift while all its local operations pass.

Each path computes its own bounds using the same tick-indexed random sequence. Tiny position changes can alter
cell membership, aggregates and selected neighbors on later ticks. The “different cells” metric compares finest-grid
input assignments with the CPU path, under each path's own frame. It is a divergence diagnostic, not a structural
correctness failure. Structural correctness instead compares with a reference built from the **same** GPU input.

## Reading the view

All four panels share one camera. The chart shows linear-scale RMS position drift in world units. The table also
shows RMS motion per tick and RMS radius around each path's centroid. All present points, including pinned points,
contribute to position metrics; absent points are excluded. Pinned/absent flags and preserved coordinates remain
part of the strict local position checks.

The force has fixed alpha and no attraction. Expansion is expected; this experiment cannot establish layout
convergence or graph quality. Cooling and force composition must be assessed explicitly in the next experiment.
For comparison, [D3's simulation documentation](https://d3js.org/d3-force/simulation) treats force application,
velocity decay and cooling as separate parts of a simulation tick. Cosmos's own force order and integration rules,
not D3's integration, will define the combined-force experiment.

## Native Apple M3 findings

Standalone Chrome, luma.gl 10.0.0-alpha.4, eight samples per cell, precise quality, 20 independent ticks.
Values are rounded to three significant digits from the lab display. Both corrected WebGPU variants finished with
identical positions in all four cases; the table shows their common drift.

| Fixture / points | WebGPU failed local ticks | WebGL failed local ticks | WebGPU RMS / max drift from CPU | WebGL RMS / max drift from CPU |
| --- | ---: | ---: | ---: | ---: |
| Uniform / 512 | 0 / 20 | 0 / 20 | 4.73e−6 / 2.29e−5 | 5.75e−6 / 3.05e−5 |
| Clusters / 8,192 | 0 / 20 | 1 / 20 | 8.87e−5 / 1.79e−3 | 2.49e−4 / 9.71e−3 |
| Clusters / 16,384 | 0 / 20 | 1 / 20 | 1.93e−4 / 6.51e−3 | 5.19e−4 / 2.44e−2 |
| Coincident / 512 | 0 / 20 | 0 / 20 | **1.33 / 18.5** | **1.33 / 18.5** |

The dense WebGL failures occurred at tick 1, consistent with the previously recorded dense precision issue. Its later
passing checks do not erase that first failure. The streamed correction therefore retains its observed precision
benefit over these independently evolving dense paths, while using about 80% less extra storage than the full buffer.

The coincident case is the stronger warning against equating local correctness with trajectory agreement. All
local checks pass, but the GPU paths finish 1.33 world units RMS from CPU, with maximum displacement 18.5. Their RMS
radius is about 130; at the final tick, 28 input points occupy different finest-grid cells from the CPU path.
Radius is reported as context, not used to normalize away the displacement or invent an acceptable error budget.
This observation is consistent with small numerical differences changing later interactions; it does not isolate
which first arithmetic operation causes the split.

The first dense results are encouraging for the memory optimization. They do **not** establish a stable final graph:
alpha stays fixed, the points keep moving, and no links attract them. The next migration question is combined-force
behavior with the production force order, cooling schedule and integrator, checked across longer runs and more GPUs.

Software Chromium regression tests cover 20 independent ticks on uniform, clustered and coincident fixtures at
512 points. Both corrected paths must pass the original local budget on every tick. Separate tests ensure a
local mismatch remains visible, paths are never reset to CPU positions, and missing backends cannot produce a
complete comparison. Native results above are observations, not hard-coded timing or drift expectations.

## Reproduce

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/repulsion-trajectories
```

Open **Repulsion trajectories**, choose a fixture, point count, sample budget and quality, then **Run 20 ticks**.
Run again to continue from those positions. **Step + validate** advances one tick. **Stop** takes effect after the
current tick; partial results remain exportable. Changing settings or resetting starts from the common fixture.
Local mismatches are recorded while finite paths continue. A device error or non-finite present position stops that
path; other paths remain available and the comparison is marked partial.

**Export JSON** includes settings, parameters, original tolerance, devices, per-tick local checks, drift, frames and
first-failure input/output arrays. Missing backends are never treated as passing. Keep captures local; commit concise
findings and reproduction instructions rather than JSON or ZIP artifacts.
