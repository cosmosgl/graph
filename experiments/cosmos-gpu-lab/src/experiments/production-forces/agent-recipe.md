# Replaying the public Graph force comparisons

From the repository root, build the WebGL control and WebGPU candidate. Use different artifact run names for native Chrome and SwiftShader. The UI runs at `#/production-forces` in the GPU Lab.

```sh
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
LAB_ARTIFACT_RUN=force-native pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-forces/packages.test.ts
LAB_ARTIFACT_RUN=force-swiftshader LAB_SWIFTSHADER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-forces/packages.test.ts
```

The method page gives the thresholds and checkpoints. Each JSON includes the package-reported adapters, per-tick maximum coordinate difference, differing point count, paired RMS distance, radii and motion since the previous recorded tick. Ticks 1 and 32 are one update after their previous checkpoint. Matching floating-point coordinates and matching pixel colors are separate measurements.

For timing, make a source archive that includes tracked files and untracked build inputs, rebuild from that source and retain both bundle hashes. Stop other GPU tests and builds. Run the opt-in test alone in a visible browser on a native adapter. The timer starts after the preceding Graph position readback has completed. Bracket the candidate with two WebGL controls. `p50` is the average of the two middle samples and `p95` is the nearest-rank 95th percentile.

```sh
VITE_LAB_FORCE_TIMING=1 LAB_NATIVE_VISIBLE=1 LAB_ARTIFACT_RUN=force-native-timing \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-forces/timing.test.ts
```

## Recorded source and outputs

### Replay Lasso Selection at the same simulation ticks

Start `pnpm run storybook` and `pnpm run storybook:webgpu` in separate terminals. From the repository root run the following command with native Chrome installed.

```sh
node experiments/cosmos-gpu-lab/scripts/lasso-story-replay.mjs
```

The driver opens the real story at each preview URL and supplies the same mesh and simulation seeds in its own browser pages. Normal visits to either Storybook use fresh random inputs. The driver pauses the running Graph at the requested tick, reads every position and checks the mesh digest, cluster assignments, simulation seed, camera and native adapter. It writes a source archive, a per-tick JSON report and side-by-side canvas captures at ticks 1, 60 and 240 to a new `captures/lasso-story-*` directory. Open the resulting `comparison.html` to view the frames. Optional positional arguments override the WebGL and WebGPU preview URLs.

The checks allow one CSS pixel of RMS position difference after the first step, one CSS pixel of difference in the 90% radius at every checkpoint, and 5% difference in internal motion across ticks 240–248. Internal motion removes each cluster's translation separately for every step. See the results for the observed differences.

Chrome 158.0.8127.37 on Apple M3 ran the baseline at `captures/lasso-story-2026-11-24T19-49-32-982Z/` and the corrected force from `d9c902e4` at `captures/lasso-story-2026-11-24T19-58-51-187Z/`. Both used the same 22,500-point mesh, Graph seed, camera and viewport.

### Earlier packaged force runs

The local capture root is `experiments/cosmos-gpu-lab/captures/package-forces-20261124/`. Final correctness records are under `final-44933b5c-native/` and `final-44933b5c-swiftshader/`. The original miss is in `baseline-native.json`. It ran on the baseline WebGPU bundle with SHA-256 `9d1b715dd6686f741caf344c514385f8202e1d216ca8ebfebb259fc641a82b85`.

The isolated benchmark used Chrome 157, Node 24.6.0, pnpm 10.15.0, WebGL luma.gl 9.3.6 and WebGPU luma.gl 10.0.0-alpha.15. The WebGL device reported ANGLE Metal Apple M3, and WebGPU reported Apple metal-3 and fallback false. Both builds used the worktree based on `5a3321f57d0a6b6187fbe5c097934a9b95ab2601`.

| Artifact | SHA-256 |
| --- | --- |
| Timing source archive, `native-timing/source.tar.gz` | `9543bf05a8fa02c241037285821b8d28cb03b7c5be35b8a0c66c707c39ff418e` |
| WebGL control for correctness and timing | `71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d` |
| WebGPU candidate for timing | `ef550b612e2344ef54be0b99c8b3b9152711a52997a1866475feef8bd04b25a9` |
| Final correctness source archive, `captures/package-lines-final-20261124/source.tar.gz` | `293a67d43f565d607817ee0663fb4a30082f5110cf7fe18aa1376f7d923f4821` |
| WebGPU candidate for final correctness | `44933b5ca508aa04395fc69b45ca088ab0aba4e90e2849def09a458bac66f435` |

The timing record is `native-timing/package-forces-hierarchy-timing.json`. The archive and the two exact standalone bundles are alongside it. The later combined build includes link drawing and picking changes, exact zero-axis handling for the pointer and method ordering. The hierarchical repulsion implementation is the same in both builds.

## Combined force comparison

Open `#/production-forces?section=try-combined`. Rebuild both packages before starting the force suite. The native and SwiftShader commands above cover the combined case and its two additional checks. `package-forces-combined.json` retains the 0/1/4/8 coordinate arrays, metrics and backend descriptors. `package-forces-combined-reference.json` records the WebGL force-off controls. `package-forces-combined-picks.json` records the initial and final RGBA samples and public click IDs for both reset paths.

The initial independent native WebGL trajectory and its repeat are in `captures/combined-forces-20261124/webgl-reference-first.json`. They also identify the midpoint probes at tick 0 and tick 8. Focused paired runs for the same graph use `captures/combined-forces-20261124/native/` and `swiftshader/`. The source for the controls and public caller is in this directory's `fixture.ts`, `frame.ts` and `packages.test.ts`. Frame coordinates are relative to the individual canvas. To verify them with an actual mouse, center the canvas in view and account for its displayed scale.

The focused run used the WebGL and final WebGPU correctness bundles in the table above. Their hashes and the force fixture source hashes are in `combined-forces-20261124/manifest.json`. The native reference process reported Chrome 158.0.8127.37. Both Vitest runs recorded a Chrome 158 user agent, and checked the adapters at runtime. The real mouse replays are in `captures/motion-mixed-20261124/ui/combined-{1200,1000,390}.json`.

## Dense communities and the movable hub

Run the WebGL reference before examining the candidate whenever you change a scaled fixture. Both built packages use one caller in `fixture.ts`. The public point, link and background probes in `scale-probes.ts` were frozen from two native WebGL replays. The nine checkpoints report all coordinates, per-community quality, pin and topology checks, and the paint and callback at each applicable probe.

```sh
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
LAB_ARTIFACT_RUN=dense-hub-reference pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-forces/scale-packages.test.ts -t 'records two WebGL'
LAB_ARTIFACT_RUN=dense-hub-native pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-forces/scale-packages.test.ts
LAB_ARTIFACT_RUN=dense-hub-software LAB_SWIFTSHADER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-forces/scale-packages.test.ts
LAB_ARTIFACT_RUN=dense-hub-timing pnpm --filter @cosmos.gl/gpu-lab benchmark:packaged-forces
```

Choose fresh capture names on each rerun. Keep other GPU jobs and builds outside the timed run. To replay the complete packaged regression, pass these six Vitest files to `test:gpu` on each adapter. The force suite has two files.

```sh
src=src/experiments
pnpm --filter @cosmos.gl/gpu-lab test:gpu \
  "$src/production-lines/packages.test.ts" "$src/production-forces/packages.test.ts" \
  "$src/production-forces/scale-packages.test.ts" "$src/production-points/packages.test.ts" \
  "$src/production-force-collision/packages.test.ts" "$src/production-graph-api/packages.test.ts"
```

The raw runs live in `captures/scale-forces-20261124/`. `native-reference-first/` holds the two controls and three force-off runs per topology. `final-5c378cfe-native/` and `final-5c378cfe-swiftshader/` hold the six test files on each adapter. Each run manifest records the exact Chrome version, package hashes, full commit and command. The timing study retains a source archive and hash, bundle hashes and the individual Chrome session records. Desktop and narrow physical-click and reset replays are in `captures/scaled-forces-20261124/ui/`. [Thresholds and coverage](#/production-forces?section=doc-scale-method) · [Native frame and click results](#/production-forces?section=doc-scale-timing)
