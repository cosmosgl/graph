# Initial correctness findings

Both approaches produced centers close to the CPU reference for the same 8,192 moving points.
This was a local correctness smoke run, not a controlled performance benchmark.

Recorded on **5 November 2026**, in a Chromium development session on macOS,
using luma.gl `10.0.0-alpha.4` and the WebGPU core profile. The exact GPU and browser version were
not recorded. Inputs used `float32x2`; WebGPU used two reduction passes with workgroup size 256.
Both backends read their results back on every tick.

| Approach | Center error vs CPU | Representative warm tick |
| --- | ---: | ---: |
| WebGL additive blend | 2.124e-9 | ~4.2 ms |
| WebGPU compute reduction | 3.252e-10 | ~0.9 ms |

The observed center difference between backends was about **2.260e-9**. Displayed time includes
upload, GPU work, synchronization, readback and drawing. First-tick pipeline and driver warm-up
must be excluded from comparisons. These individual observations do not establish a general speedup.

## Reproduce the check

1. From the repository root, run `pnpm --filter @cosmos.gl/gpu-lab dev`.
2. Open [Global center of mass → Demo](#/center-mass) and wait for both backends to initialize.
3. Use **Reset**, then **Step** repeatedly. Compare the displayed CPU, WebGL and WebGPU centers,
   errors and tick timings on the same tick. **Play** advances the shared input continuously.
4. Record the implementation variant, GPU, browser and workload with any observations. Expect different
   timings and small floating-point differences on other devices.

For repeatable timing with warm-up, repeated samples and **Export JSON**, use
[Performance Lab](#/performance-lab) and its simulation/reduction workload. Its isolated benchmark
has different timing boundaries from this tick-by-tick smoke check; see its methodology before comparing numbers.
Raw measurement captures are kept locally, not in Git.
