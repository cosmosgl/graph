# Replaying the packaged Lines comparison

Build both standalone Graph packages from the repository root. Use an unused artifact run name for each adapter. The Lab preview is at `#/production-lines`.

```sh
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
LAB_ARTIFACT_RUN=lines-native pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-lines/packages.test.ts
LAB_ARTIFACT_RUN=lines-software LAB_SWIFTSHADER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-lines/packages.test.ts
```

Each run produces 36 JSON files under the Lab's ignored `captures/` directory. Each file includes the actual device descriptions, the full-canvas RGBA comparison, the edge and interior measurements, and the expected and observed click IDs. The moving-endpoint test also restores the starting geometry and checks both images and callback sequences against each package's original state.

## Recorded source and packages

The final run is in `experiments/cosmos-gpu-lab/captures/package-lines-final-20261124/`. The original WebGPU control is in the sibling `package-lines-original-control-20261124/` directory. Both used the Chrome channel, Node 24.6.0 and pnpm 10.15.0. The WebGL renderer reported ANGLE Metal Apple M3 for the hardware run and ANGLE Vulkan SwiftShader for the software run. WebGPU reported Apple metal-3 and SwiftShader respectively.

Chrome updated during the study. The early native UI check recorded 157.0.8103.79. The final live preview checks on both adapters recorded 158.0.8127.37 in `ui/native.json` and `ui/swiftshader.json`. The standalone Vitest matrix recorded the adapters and browser channel. Its exact browser build is unrecorded.

| File | Original WebGPU control | Final candidate |
| --- | --- | --- |
| Source archive SHA-256 | `790dc6d718e6f4194e54a3c9fc9b4d5a8e3090168645c926cf2407cb2f60244f` | `293a67d43f565d607817ee0663fb4a30082f5110cf7fe18aa1376f7d923f4821` |
| WebGPU standalone SHA-256 | `9d1b715dd6686f741caf344c514385f8202e1d216ca8ebfebb259fc641a82b85` | `44933b5ca508aa04395fc69b45ca088ab0aba4e90e2849def09a458bac66f435` |

The WebGL control SHA-256 is `71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d` in both runs. Each capture contains a `run.json` manifest, `SHA256SUMS`, both standalone bundles, `source.tar.gz`, and the individual `native/` and `swiftshader/` results. The original-control archive contains the **test harness** used for the replay. Its archived WebGPU binary comes from the original package built before these changes. Both worktrees were based on `5a3321f57d0a6b6187fbe5c097934a9b95ab2601`.

| Adapter | Original differing pixels | Final differing pixels | Original incorrect click targets | Final incorrect click targets |
| --- | ---: | ---: | ---: | ---: |
| Apple M3 | 8,541 | 43 | 28 | 0 |
| SwiftShader | 8,645 | 7 | 28 | 0 |

Each row compares 3,686,400 pixels and 294 expected click targets. Both original runs failed 16 of 18 tests. Both final runs passed all 18. Straight, moving, gradient, dashed and zoom fixtures now assert byte-exact frames at both pixel ratios. Other fixtures report the same exact count and assert the outline, interior-color, style and click-target checks.

To replay an archived pair, extract its source at the workspace root and use the locked dependencies. Copy `webgl.js` to `dist/index.min.js` and `webgpu.js` to `experiments/graph-webgpu/dist/index.min.js`. Run the two test commands against these binaries. The expected failures in the original control demonstrate the checks' sensitivity to lost click padding, misplaced dots and different curve geometry.

## SwiftShader endpoint sweep

The distinct 30-link control lives in `experiments/cosmos-gpu-lab/captures/production-lines-renderer-r3ZMwk/`. It retains the fixture, runner, three frozen bundles and both `cap-sweep-before.json` and `cap-sweep-final.json`. This sweep places vertical links at projected endpoint rounding ties with three stroke widths. Its measured scope and remaining differences are in the results page.

```sh
node experiments/cosmos-gpu-lab/captures/production-lines-renderer-r3ZMwk/cap-sweep.cjs software straight,gradient,dashed,dotted,arrows /tmp/cosmos-caps.json
```
