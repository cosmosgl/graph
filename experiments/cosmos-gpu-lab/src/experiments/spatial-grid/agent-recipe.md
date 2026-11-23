# Check spatial grid membership

From the repository root, run
`pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/spatial-grid/grid.test.ts`
in a WebGPU-capable browser with a unique `LAB_ARTIFACT_RUN`. Each fixture writes its browser,
runtime-reported device, scan hierarchy and mismatch counts to the Lab’s `captures/<run>/`.

Compare every GPU count, offset and cell range with the CPU reference. Each input ID must appear
once in its expected cell, including the four explicit corner probes. The 257 × 257 diagonal
fixture reflects the diagonal across the x axis between two builds on the same allocations. Check all three scan levels against the updated CPU reference. The five-million-point
clustered fixture stresses contended cells at the largest demo preset. Vitest runs all three fixtures.
The page reruns the uniform and diagonal fixtures and shows the recorded result for the stress case. Require zero device errors.
Build timings are outside this correctness check.
