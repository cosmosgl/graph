# Scalable reduction findings

All four presets initialized, reduced, rendered and returned finite centers in a local Chromium
session. The hierarchy scales to ten million GPU-resident points; this was exploratory validation,
not portable benchmark data.

Recorded on **5 November 2026**, on macOS with luma.gl
`10.0.0-alpha.4` and the WebGPU core profile. The exact GPU and browser version were not recorded.
Workgroups contained 256 invocations, positions were generated on the GPU, and rendering sampled
at most 500,000 points.

| Points | Reduction hierarchy | Error vs CPU | Tick with readback | Bounded reduction benchmark |
| --- | --- | ---: | ---: | ---: |
| 8,192 | 8,192 → 32 → 1 | 4.341e-9 | 3.7 ms | Not recorded |
| 65,536 | 65,536 → 256 → 1 | 6.124e-9 | 5.0 ms | Not recorded |
| 1,000,000 | 1,000,000 → 3,907 → 16 → 1 | 5.499e-9 after one tick | 9.7 ms | 0.67 ms average × 20 |
| 10,000,000 | 10,000,000 → 39,063 → 153 → 1 | CPU reference skipped | 34.5 ms | 2.62 ms average × 5 |

One-million and ten-million ticks also worked without CPU readback, drawing the center directly
from GPU storage. The ten-million preset used a **76.3 MB position buffer** and **1.2 MB of ping-pong
partial storage**. A finite center at that scale is not proof of numerical accuracy; no ten-million
CPU reference was checked.

The bounded benchmark measures CPU wall time through queue completion for repeated reductions.
It excludes position generation, movement, drawing and readback. It is not GPU timestamp timing,
and cannot be compared directly with the visible readback tick. See [Performance](#/scalable-reduction/docs/performance).

## Reproduce the check

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` from the repository root.
2. Open [Scalable reduction → Demo](#/scalable-reduction). Select each of the four point-count presets.
3. Keep **Read center back to CPU** enabled, use **Reset**, then **Step**. Inspect the hierarchy,
   center and CPU error where available.
4. At one million and ten million points, disable readback and step again to check GPU-resident rendering.
5. Run **Benchmark** for the bounded reduction average. Record the preset, readback mode, browser,
   GPU and implementation variant; numbers will vary by machine and load.

For JSON-exportable reduction comparisons, use [Performance Lab](#/performance-lab). Its workload
and timing methodology differ, so do not treat it as a replay of these exact measurements.
Keep raw captures locally and commit only the findings and reproduction instructions.
