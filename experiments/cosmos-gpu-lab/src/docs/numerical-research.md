The WebGPU migration needs independent checks of behavior and numerical accuracy. Reproducing one
JavaScript float32 operation sequence is useful compatibility evidence, but is not a universal
correctness requirement. Preserve the existing strict candidates and gates while evaluating native
arithmetic, quality and cost under separate contracts.

Assessment: **12 November 2026**. This report combines a repository review with the primary sources
below. Historical GPU timings are observations from their linked studies, not newly repeated results.

## What the specifications establish

**WGSL allows numerical variation.** It permits reassociation and certain fusion, specifies no single
rounding mode for intermediate results, allows flushing many subnormal inputs/outputs to zero, and
gives operation-specific accuracy limits. Native division and trigonometry need not reproduce
JavaScript results. Runtime NaN, infinity and overflow can invoke finite-math assumptions. These
rules justify explicit input domains and independent error budgets; they do not excuse an inaccurate
application result. [WGSL numerical evaluation, sections 15.7.2–15.7.5](https://www.w3.org/TR/2026/CRD-WGSL-20261106/#floating-point-evaluation).

**JavaScript is a model, not exact real arithmetic.** `Math.fround` converts to binary32 using
round-to-nearest, ties-to-even. Functions including `atan2`, `cos` and `hypot` return
implementation-approximated results. Repeated `Math.fround` calls specify a useful arithmetic path,
but do not emulate every permitted GPU evaluation.
[ECMAScript Math functions](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.fround).

**Production GLSL is also fallible.** GLSL ES 3.00 section 4.5.1 specifies storage and operation
precision but leaves precision undefined for some built-ins, including trigonometric functions.
An observed WebGL/CPU mismatch is not enough to identify a driver violation; a shared WebGL/WebGPU
answer does not prove an accurate algorithm.
[GLSL ES 3.00 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).

**Acceptance intervals are established testing practice.** The WebGPU CTS explains why many
floating-point operations have a range of permitted answers, and composes acceptance intervals for
inherited accuracies. CTS intervals test language conformance. Cosmos needs its own, potentially
tighter accuracy and quality requirements; implementing all CTS machinery in this lab is unnecessary.
[WebGPU CTS floating point primer](https://github.com/gpuweb/cts/blob/main/docs/fp_primer.md).

**Accuracy and reproducibility are different objectives.** Ahrens, Demmel and Nguyen explain how
nonassociative addition and parallel scheduling complicate reproducibility, and give algorithms
with explicit accuracy and work costs. This supports studying summation order and cancellation;
it does not require Cosmos to adopt their reproducible accumulator.
[Algorithms for Efficient Reproducible Floating Point Summation, 2020](https://people.eecs.berkeley.edu/~demmel/ma221_Fall23/J115_Efficient_Reproducible_Summation_TOMS_2020.pdf).

## What the repository evidence shows

| Observation | Implication | Scope |
| --- | --- | --- |
| Dense local-force contributions re-summed in double precision reduced the recorded error from about `0.0005026` to `0.000000445` | An independent reference isolated accumulation loss and motivated a useful blocked sum | Captured contributions and sampled native-device cases; see [dense precision](#/neighborhood-forces?section=doc-precision) |
| Refined gravity increased a recorded stage median from `0.1720` to `2.9819` ms | Reproducing polar arithmetic can have substantial cost without establishing its production necessity | Historical 8,192-point M3 frozen-stage comparison; see [gravity study](#/combined-layout?section=doc-gravity-trig) |
| The gravity reference reproduces distance, angle, sine and cosine although the intended force is linear | Compare direct Cartesian evaluation against the intended law as well as the compatibility model | Algebraic equivalence holds in exact arithmetic; floating-point domain and integration still require testing |
| Matched-layout WebGL results retain numerical failures despite close quality scores | Existing GLSL is a comparison implementation, not an unquestionable oracle | The documented fixture/device matrix; see [matched findings](#/matched-layout?section=doc-findings) |
| Resident and retained-capacity studies compare state bits with staged/rebuilt controls | Exact equality is appropriate when storage or scheduling is the intended change | Shared force code can share bugs; independent force checks remain necessary |
| Matched adaptive runs share CPU-derived sampling decisions | They isolate force differences but do not validate independent runtime adaptation | See the [matched method](#/matched-layout?section=doc-method) |

Source anchors: `combined-layout/reference.ts` (polar gravity model), `many-body/reference.ts`
(float32 operations and tolerance), `weighted-links/reference.ts` (independent edge lists),
`many-body-grid/reference.ts` (port and approximation controls), and `matched-layout/session.ts`
(CPU sampling tape), under `src/experiments/`.

## Decisions for the lab

Keep mathematical, float32 compatibility, structural and execution references distinguishable.
Use exact comparisons for identity, masks, state preservation and algorithm-preserving execution
changes. Do not require every new algorithm to preserve an old reduction order or long trajectory.
Accept an alternative only after its behavioral, numerical, quality and cost requirements are met.
Language conformance alone is insufficient, and historical gate failures are never silently waived.

Standardize the [validation contract](#/matched-layout?section=doc-validation-contract) in each example and
follow the [validation workflow](#/validation-workflow). The matched comparison separates limited
flag/restoration evidence, legacy compatibility and measured-only quality. It does not manufacture
an independent mathematical accuracy verdict or a complete behavioral pass from those checks.

## Bounded precision studies

The [precision diagnostics](#/precision-diagnostics) applies the workflow to frozen inputs:

1. Compare production GLSL gravity and native WGSL polar/Cartesian formulas with the analytic linear
   force, alongside the existing CPU polar compatibility model. Report both error and compatibility
   results. No production shader or tolerance is changed.
2. Compare serial, blocked and tree summation on identical bounded-integer float32 fixtures with
   exactly representable sums. Report errors and captured outputs; arithmetic order hypotheses do
   not become compiler claims. The sum kernels are diagnostic WGSL, not the production WebGL blender.

These studies have no new production thresholds, strict-candidate approval or frame-time claim.
Use their export for device-specific observations. The next acceptance evidence is independent
candidate integration, multiple seeds/graph families, agreed layout-quality budgets, representative
runtime timing, and other intended native GPUs. Broader precision investigation is warranted when
the bounded cases expose consequential errors, not merely differing bits.

## First application of the workflow

The [native M3 findings](#/precision-diagnostics?section=doc-method) record nine completed UI runs on
12 November 2026, Chrome 157 and pinned luma v10, through 4,096 records. Cartesian WGSL has lower
maximum mathematical force error than the CPU polar model while passing its legacy gate. The
native polar diagnostic exposes two wrong-direction vertical-axis cases, outside `atan2`'s ordinary
bounded accuracy domain; this is not a demonstrated driver violation or a failure of the strict
refined backend. Production GLSL has the intended axis signs on that device.

At 1,024 cancellation inputs, CPU and native WGSL serial sums both return 1 for an exact sum of 512;
blocked sums return 16 and tree sums return 512. Positive and balanced controls are exact in the
tested paths. This demonstrates why matching a CPU model and obtaining an accurate answer must be
reported separately. The diagnostic makes no trajectory, integration or performance claim.
