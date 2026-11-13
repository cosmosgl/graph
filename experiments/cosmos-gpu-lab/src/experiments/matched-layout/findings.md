# Matched layout findings

This is the **center-off baseline**. The [center-enabled comparison and GPU cost measurements](#/matched-layout/docs/center) extend it with the optional production center force.

**The strict WebGPU candidate reproduced the independent CPU trajectory with zero measured pointwise drift across 12 M3 runs and 11,200 ticks.** All 1,132 frozen checkpoints and 12 full-strength probes passed the original numerical gate. This supports a behavioral port of this bounded Cosmos force sequence. Production WebGL’s layout scores stayed close, while its scalar numerical checks retained failures.

Measured on **11 November 2026**, Apple M3, standalone Chrome 156, luma `10.0.0-alpha.4`. WebGL used ANGLE Metal and the repository’s production GLSL through luma v10. This is a matched shader/algorithm comparison; complete `Graph` runtime scheduling and public API behavior remain outside the study. See the [method](#/matched-layout/docs/method).

## Measured matrix

Every run used explicit unit link weights, pin on point 0, origin `(2048, 2048)`, production spring variation and the adaptive preset. Exact repulsion applies through 4,096 points; adaptive grid decisions only apply to the 8,192-point rows. CPU and WebGPU continued independently on every tick.

Stress below is the final CPU/WebGPU scale-fitted RMS score. At 128 points it includes all connected pairs; larger rows use the documented 16-landmark estimate. Drift is final WebGL RMS displacement from CPU divided by the CPU layout radius, expressed as a percentage. Quality scores have no acceptance threshold here.

| Points | Graph / distribution | Ticks | WebGL checkpoints pass | WebGPU checkpoints pass | Stress RMS | WebGL drift / radius |
| --- | --- | --- | --- | --- | --- | --- |
| 128 | Chain / uniform | 100 | 11 / 11 | 11 / 11 | 0.815634 | 0.00138% |
| 128 | Communities / uniform | 100 | 11 / 11 | 11 / 11 | 0.486684 | 0.00414% |
| 128 | Star / uniform | 100 | 11 / 11 | 11 / 11 | 0.420264 | 0.00729% |
| 512 | Chain / uniform | 100 | 11 / 11 | 11 / 11 | 0.912815 | 0.00313% |
| 512 | Communities / uniform | 100 | 11 / 11 | 11 / 11 | 0.753876 | 0.04503% |
| 512 | Star / uniform | 100 | 11 / 11 | 11 / 11 | 0.415129 | 0.00428% |
| 8,192 | Chain / uniform | 100 | 10 / 11 | 11 / 11 | 0.984082 | 0.04166% |
| 8,192 | Communities / clusters | 100 | 8 / 11 | 11 / 11 | 0.946225 | 0.01744% |
| 8,192 | Star / uniform | 100 | 9 / 11 | 11 / 11 | 0.425352 | 0.27492% |
| 8,192 | Communities / clusters | 300 | 27 / 31 | 31 / 31 | 0.927881 | 0.07454% |
| 128 | Communities / uniform | 5,000 | 498 / 501 | 501 / 501 | 0.359005 | 0.43673% |
| 512 | Communities / uniform | 5,000 | 479 / 501 | 501 / 501 | 0.546703 | 0.04448% |

All runs retained finite present positions and completed both GPU paths. Numerical validity is separate: WebGL passed **1,097 / 1,132** ordinary checkpoints and **8 / 12** probes. WebGPU passed every recorded gate. Intermediate force stages between checkpoints were not numerically validated.

## Similar layouts can retain numerical failures

WebGL’s largest final stress difference from CPU was `0.00007841`; the largest difference anywhere in the recorded stress histories was `0.00029699`. Shared-camera drawings and spring-mismatch scores were also close. These measurements describe the selected graphs and metrics, not general graph readability.

The strict gate still records important details:

- The 8,192-point chain and star failed 107 repulsion-force components at the first checkpoint. The star also failed 41 at tick 10.
- Dense 8,192-point communities initially failed 4,331 repulsion-force components and 16 post-repulsion position components, plus some spring-force components. Further selected spring checks also failed.
- The 5,000-tick exact communities runs retained 3 failed checkpoints at 128 points and 22 at 512 points, involving spring-force comparisons.
- All recorded whole-tick position checks passed. They do not override failed local checks. The relative position budget uses the actual world-coordinate frame; force checks remain separate.

The first ordinary failure replayed with identical output bits and check results in all five runs where replay was performed: the three 8,192-point 100-tick cases and the two 5,000-tick cases. Independent positions were restored bit for bit. The 300-tick run retains its capture without a recorded replay; probe-only failures are displayed separately. The underlying WebGL arithmetic differences have not been isolated by this quality study.

No tolerance, production GLSL or pre-existing CPU operation order was changed to make a result pass. The new world-origin input is rounded to float32 like the GPU uniform. The previous centered-coordinate studies retain their original path.

## Cooling length changes the quality conclusion

At 512-point communities, extending the cooling schedule from 100 to 5,000 ticks changed CPU/WebGPU stress from **0.753876 → 0.546703** and directional spring mismatch from **0.652373 → 0.347935**. At 128 points, stress changed from **0.486684 → 0.359005**.

The larger dense-community control improved from **0.946225 → 0.927881** stress and **3.737881 → 2.484041** spring mismatch at 100 versus 300 ticks. Its shared sample tape selected 64 slots before tick 1, retained them at tick 31, then changed to 8 before tick 61. Uniform 8,192-point cases selected 8 before tick 1. Sampling decisions are deliberately synchronized to the CPU trajectory, rather than driven by separate wall-clock controllers.

Low cooled motion still does not establish force balance. After 5,000 ticks, 512-point CPU/WebGPU communities moved only `0.000176` RMS in their last cooled tick, but the alpha = 1 probe moved **1.32104** RMS, about **1.38%** of the pre-probe layout radius. The 8,192-point star’s 100-tick probe moved **40.7565** RMS, about **60.37%** of its pre-probe radius. Probes restore layouts and cooling afterward.

## What this means for Cosmos

The composed gravity → repulsion → directional springs → cooling sequence now has matched WebGL/WebGPU/CPU evidence in the default world frame, including two independently evolved default-length schedules. Keeping numerical agreement, layout quality and GPU cost as separate contracts exposes differences that a final picture or a position-only check would hide.

This study does **not** select a production arithmetic policy or establish a WebGPU speedup. It includes per-tick CPU work and GPU readback. Full runtime adaptation, implicit/default weights, broader graph families and landmark sets, remaining forces, renderer/interaction parity and other GPUs still need validation. Absolute layout-quality targets also remain to be agreed. Center attraction is the next force-composition step on the [migration roadmap](#/roadmap).

## Reproduce

1. Run `pnpm install`, then `pnpm --filter @cosmos.gl/gpu-lab dev`; open the Vite URL and **Matched layout comparison**.
2. Choose **Adaptive samples · production spring variation**, **Pin point 0**, **Center attraction = Off**, and the graph/distribution/count/cooling row above. Confirm the controls before starting.
3. **Run comparison**, then **Probe at α = 1**. If ordinary failures were captured, use **Replay failures** and inspect restoration. Every first/tenth/final tick is checked; **Step + check** can check an additional selected tick.
4. **Export JSON** for local evidence, including environment, parameters, sample decisions, histories, checks and failure inputs. Commit Markdown findings and reproduction steps; keep measurement exports local.

Focused regression checks use `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/matched-layout`. They exercise shorter trajectories, the inclusive 4,096/4,097 cutoff, origin handling, metric invariants, restoring diagnostics and partial-backend UI behavior; they do not automatically run this full matrix. Ordinary software-browser CI covers the metric and unavailable-backend tests, while native shader checks are opt-in.
