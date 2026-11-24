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
