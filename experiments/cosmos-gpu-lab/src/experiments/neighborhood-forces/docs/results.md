# Initial neighborhood-force findings

The first local browser check matched the CPU reference for both tiled all-pairs and spatial-grid
forces. At 1,024 uniform points, the grid reduced candidate checks from 1,023 to about 22.6 per point.
This records the initial implementation; the later [precision findings](#/neighborhood-forces/docs/precision)
and [precision cost comparison](#/neighborhood-forces/docs/precision-cost) cover the corrected dense-case kernels.

Recorded on **9 November 2026**, using the initial neighborhood-force implementation in Chrome 156 on macOS. The session exposed eight logical processors and used
480×480 canvases at device pixel ratio 2. GPU identity and power state were not captured.

Parameters: **1,024 points**, uniform distribution, **32×32 grid**, radius **0.08**, strength **0.12**,
`dt = 1/60`, damping **0.95**.

| Check | Tiled all-pairs | Spatial grid |
| --- | ---: | ---: |
| CPU reference targets | 1,024 | 1,024 |
| Neighbor-count mismatches | 0 | 0 |
| Maximum force error | 3.726e-8 | 4.280e-8 |
| Maximum position error | 3.909e-8 | 3.909e-8 |
| Mean candidates per point | 1,023 | 22.646 |

Both paths also passed validation after one tick. The live 65,536-point uniform preset passed its
128-target CPU sample with zero neighbor mismatches, maximum force error **2.86e-6** and maximum
position error **4.09e-8**. That larger check was sampled, not exhaustive. The initial dedicated
Chromium regression run passed eight tests, including six GPU cases; subsequent work expanded the suite.

These are correctness observations. Sub-millisecond wall timings were timer-limited and did not
establish a general speedup. See [Batched findings](#/neighborhood-forces/docs/batched-results) for
historical timing results and their limitations.

## Reproduce the checks

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` from the repository root.
2. Open [Neighborhood forces → Demo](#/neighborhood-forces). Choose **1,024 points**, **Uniform**,
   radius **0.08**, density **1×**, grid **32×32**, and the **Baseline** grid force loop.
3. Use **Reset**, then **Validate next step**. Use **Step**, then validate again to check an evolved state.
4. Repeat at **65,536 points**. All-pairs is skipped above 4,096; the grid is checked against sampled CPU references.
5. Use **Benchmark**, then **Export JSON** to save current measurements and validation locally.
   Current kernels include the precision fix, so this reproduces the workload rather than the historical shader.
6. Run `pnpm --filter @cosmos.gl/gpu-lab test:gpu` for the automated CPU/WebGPU regressions.
   This requires a WebGPU adapter and uses Chromium's software adapter; its timings are not hardware benchmarks.

Record your GPU, browser, implementation variant and power conditions when comparing results. Raw JSON and
ZIP captures are not stored in Git; this page preserves the findings and method.
