# Reproduce the center check

Run `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/scalable-reduction/reduction.test.ts`
from the repository root with a unique `LAB_ARTIFACT_RUN`. The browser needs WebGPU and an
80,000,000-byte storage binding for the largest case. Results go to `captures/<run>/` in the Lab.

65,537 points leave one point beyond two full reduction levels. The ten-million-point case uses
the largest preset. At each size, compare the initial center and the center after one GPU-resident
rotation with a CPU sum over the same generated inputs. Require an exact count and a Euclidean
center error of at most one float32 epsilon in clip space. This budget applies to these two
snapshots. Timing, long trajectories and integrated layout quality have separate acceptance criteria.

## Earlier exploratory timings

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
from GPU storage. The ten-million preset used a **76.3 MiB position buffer** and **1.2 MiB of ping-pong
partial storage**. That earlier run skipped the ten-million-point CPU reference.

The bounded benchmark measures CPU wall time through queue completion for repeated reductions.
Earlier GPU work could contribute to the recorded times because that run started the timer before draining the queue. See the [benchmark method](docs/performance.md).

The [algorithm notes](docs/algorithm.md) describe the workgroup tree and the intermediate buffers.
