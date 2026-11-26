---
source: Recorded findings
recorded: 2026-11-16
device: Apple WebGPU adapter, metal-3, fallback false; HeadlessChrome 157 on macOS; exact chip not exposed
scope: Six frozen workloads repeated twice, eight balanced trials per workload; luma.gl 10.0.0-alpha.15
---

# First compute-cache cost screen

**Investigation stopped without adoption.** The rebuilt sample cache did not justify replacing vertex generation. Static reuse showed inconsistent savings and a substantial memory cost. These findings are retained for reference; no further experiments are planned.

## Preservation

The focused native test preserved all color and ID bytes in **64/64 existing curve configurations**, including inverse/high bows, DPR 2, overlap, degenerate inputs, reversed order and both blending modes. It also compared the new vertex baseline against the original curve experiment. These are same-WebGPU preservation checks, not resolutions of the existing WebGL/CPU failures.

The larger cost fixtures found a counterexample: **10,000 short curves at three segments changed two color pixels in both repetitions**, with no ID changes. A separate inline Chromium 157 replay reproduced it: the first changed pixel was **(260, 93)**, RGBA8 **(82, 96, 111, 123)** for vertex generation and **(82, 96, 111, 122)** for the compute cache. Static reuse exactly matched rebuilding. This one-byte alpha change fails the declared exact-preservation gate. Its arithmetic cause has not been localized; no tolerance was relaxed.

All ten 19-segment cost rows preserved the checked images exactly and had nonempty baseline color.

## Native cost observations

Each cell below is median milliseconds per frame. GPU columns are **instrumented sums of within-pass durations**; completion columns come from separate uninstrumented batches. They are not the same trial or directly interchangeable. Instrumented sums were often larger than uninstrumented completion time; instrumentation/driver scheduling sensitivity is unresolved, so absolute GPU sums must not be interpreted as normal frame latency. Exported samples retain both measurements.

| Repeat | Links / segments / passes / distribution | GPU vertex | GPU duplicate | GPU rebuild | GPU reuse | Completion vertex | Completion rebuild | Completion reuse | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1,000 / 19 / color / short | 0.245 | 0.244 | 0.348 | 0.244 | 0.387 | 0.450 | 0.375 | No convincing saving |
| 1 | 10,000 / 19 / color / short | 1.273 | 1.300 | 1.415 | 1.251 | 0.863 | 1.100 | 0.812 | No convincing saving |
| 1 | 10,000 / 19 / color + IDs / short | 2.588 | 2.555 | 2.830 | 2.953 | 1.438 | 1.862 | 1.800 | No convincing saving |
| 1 | 10,000 / 3 / color / short | 0.833 | 0.834 | 0.748 | 0.797 | 0.550 | 0.737 | 0.538 | Preservation failure |
| 1 | 10,000 / 19 / color / overlap | 3.584 | 3.984 | 3.700 | 3.333 | 1.325 | 1.625 | 1.388 | Noisy baseline |
| 1 | 100,000 / 19 / color / short | 10.871 | 10.962 | 12.049 | 10.430 | 6.175 | 8.175 | 5.612 | No convincing saving |
| 2 | 1,000 / 19 / color / short | 0.108 | 0.100 | 0.149 | 0.124 | 0.287 | 0.400 | 0.287 | No convincing saving |
| 2 | 10,000 / 19 / color / short | 2.255 | 1.635 | 1.497 | 2.230 | 1.537 | 1.050 | 1.538 | Noisy baseline |
| 2 | 10,000 / 19 / color + IDs / short | 3.310 | 2.888 | 2.696 | 2.788 | 1.562 | 1.662 | 1.700 | Noisy baseline |
| 2 | 10,000 / 3 / color / short | 0.809 | 0.847 | 0.737 | 0.794 | 0.537 | 0.700 | 0.513 | Preservation failure |
| 2 | 10,000 / 19 / color / overlap | 2.923 | 2.916 | 3.303 | 3.222 | 1.237 | 1.262 | 1.237 | No convincing saving |
| 2 | 100,000 / 19 / color / short | 13.584 | 13.457 | 12.919 | 10.970 | 7.450 | 8.875 | 6.138 | Static reuse only |

No row cleared the rebuild screening gate. Three rows had more than 10% discrepancy between duplicate GPU baselines and cannot support a speed conclusion. The 100,000-link static cache cleared the heuristic in the second repetition, saving about 19% of the instrumented sum and 18% of uninstrumented completion; the first repetition saved only about 4% and 9%, respectively. It requires **30.52 MiB** of sample storage. This is not a reliable speedup claim.

Rebuilding at 100,000 links took **8.175 / 8.875 ms** of uninstrumented completion versus **6.175 / 7.450 ms** for the vertex baseline. This first simple candidate does not demonstrate that its saved conic arithmetic outweighs compute dispatch and storage traffic.

## Disposition

Keep the current vertex renderer. Adaptive tessellation, visibility culling and full compute rasterization were discussed but were not tested in this investigation and are not scheduled follow-ups.

No production shaders, configuration or picking policy changed. This screen does not establish power usage, GPU utilization, mobile performance, motion invalidation or end-to-end Graph frame cost.

[Original findings and replay](https://github.com/cosmosgl/cosmos/blob/466da466b3d83b36f6d4295939822e724dd87d35/experiments/cosmos-gpu-lab/src/experiments/ribbon-generation/findings.md#reproduce)

## Reproduce

The archived harness contains both the 64-case preservation check and the six-workload cost screen. From the repository root, create a separate checkout of its pinned revision and use that checkout’s lockfile.

```sh
git worktree add --detach ../cosmos-ribbon-replay 466da466b3d83b36f6d4295939822e724dd87d35
cd ../cosmos-ribbon-replay
pnpm install --frozen-lockfile
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/ribbon-generation/ribbon.test.ts
LAB_RIBBON_COST=1 LAB_NATIVE_GPU=1 LAB_ARTIFACT_RUN=ribbon-replay pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/ribbon-generation/cost.test.ts
```

The cost screen writes `ribbon-cost-0.json` and `ribbon-cost-1.json` under `experiments/cosmos-gpu-lab/captures/ribbon-replay/`. The second file contains both repetitions. Inspect the recorded adapter and the preservation and timing results for each workload. A completed run can include a failed gate.
