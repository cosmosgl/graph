# Independent collision layouts

**Original native-arithmetic baseline.** The follow-up [targeted correction](#/collision/docs/precision) now passes all 1,700 tick and trajectory gates in the repeated matrix, with zero measured pointwise drift. The native results below remain historical controls, including their recorded failures.

**Accurate individual ticks do not establish matching long trajectories.** With the corrected high/low center sum, WebGPU passes **1,699 / 1,700** tick gates in this study; production WebGL passes **1,589 / 1,700**. Independent coordinates exceed the original tolerance in every larger combined fixture. The cooled dense star also exposes one replayable WebGPU whole-tick failure. The numerical budgets remain unchanged throughout.

Measured **12 November 2026**, Apple M3, Codex inline browser **Chromium 157**, pinned luma `10.0.0-alpha.4`. Native regression checks run separately in installed Chrome. The earlier [center-correction findings](#/collision/docs/findings) use shared CPU starting states; this study carries each backend’s own output into its next tick.

## What evolves independently

```flow
Identical initial positions, topology, sizes, samples and alpha schedule
WebGL · Carry its own positions through production GLSL and collision | WebGPU · Carry its own positions through luma kernels and collision | CPU · Carry its own positions through the scalar reference
Record tick gates and accumulated trajectory differences · Draw all three layouts with one camera
Repeat from each path's own output
```

The independent path performs **no position-reset upload during ordinary ticks**. Positions stay in each GPU backend between ticks. Diagnostic readbacks still validate every stage and calculate metrics. Explicit failure replay uploads its captured input, then restores the live GPU positions. This is a numerical comparison, with CPU work and readback, rather than a production frame-rate benchmark.

All combined cases use gravity → center → exact repulsion → incoming springs → outgoing springs → collision. Center strength is 1. Springs use production variation `[1, 1.2]`, explicit unit link weights and the collision contact-distance floor. Resolved point diameters are 4–12, collision strength is 1, padding is 0.25, and radius comes from size / 2. Collision uses friction 1 and the native WebGPU force kernel; other force/integration precision controls remain unchanged.

Initial positions are around `(2048, 2048)`. Uniform cases use 128 points and one collision pass; dense cases use 512 points in two clusters and four passes. Chain, communities and star share these position fixtures. Community blocks have 16 points, extra edges to each block’s first point and bridges between blocks. The star is unpinned. The masked control has two pins and two absent points, including NaN coordinates.

### Three distinct comparisons

| Comparison | CPU starting state | Meaning |
| --- | --- | --- |
| Local stage gate | That GPU stage’s actual input | Does the force/integration agree at the original stage budget? |
| Whole-tick gate | That GPU tick’s own starting positions | Does the composed GPU tick agree with the complete scalar chain from the same input? |
| Accumulated trajectory gate | CPU’s independently evolved positions | Do the three histories still agree in raw coordinates at the original position budget? |

The first two form the **tick gate**. They retain `2e-5 + 3e-5 × |reference|`, with the existing tighter spring budget `2e-6 + 2e-5 × |reference|`. The trajectory comparison uses the original position budget too. Flags remain exact; only explicitly absent NaN coordinates retain their sentinel. The [existing absent-target spring contract](#/collision/docs/method) is unchanged.

No drift percentage, aligned metric or quality score turns a failed numerical check into a pass. Trajectory gates can occasionally pass again after a first difference; counts below cover every tick, rather than assuming permanent failure after the first exit.

## Constant full-strength runs

Alpha remains 1 for 100 ticks. Every row uses native collision arithmetic and the corrected center sum. `Tick` means the own-input local/whole gate; `trajectory` means accumulated coordinates against the independent CPU.

| Points / initial fixture | Topology / collision passes | WebGL tick / trajectory passes | WebGPU tick / trajectory passes | Final raw RMS drift / CPU radius: WebGL / WebGPU |
| --- | --- | --- | --- | --- |
| 128 / uniform | Chain / 1 | 100 / 10 | 100 / 35 | 11.716% / 0.188% |
| 128 / uniform | Communities / 1 | 91 / 3 | 100 / 25 | 35.761% / 5.570% |
| 128 / uniform | Star / 1 | 100 / 4 | 100 / 5 | 320.582% / 173.886% |
| 512 / dense | Chain / 4 | 98 / 0 | 100 / 1 | 29.905% / 21.685% |
| 512 / dense | Communities / 4 | 84 / 0 | 100 / 1 | 40.572% / 40.055% |
| 512 / dense | Star / 4 | 39 / 0 | 100 / 1 | 479.879% / 438.088% |

All counts are out of 100. WebGPU passes every tick gate here, while trajectory agreement has a much smaller envelope. At 128 uniform chain points, its first trajectory difference occurs at tick 29; 35 of the 100 ticks pass that gate. For the dense fixtures, WebGPU’s first accumulated difference occurs at tick 2. Production WebGL already fails the dense fixtures’ trajectory gates at tick 1.

Large star drift includes movement of the layout center. At 128 points, removing translation and rotation reduces WebGPU RMS drift from 173.886% to **79.819%** of CPU radius. At 512 points the aligned value is **126.189%**, versus 438.088% raw. There is still substantial pointwise shape disagreement. Similar radius or stress does not establish matching node placement.

## Cooling and convergence

The dense fixtures also run for 300 independently evolving ticks. All paths use the same tick-based schedule, starting at alpha 1:

```ts
alpha += (0 - alpha) * (1 - Math.pow(0.001, 1 / coolingTicks))
```

Cooling follows the lab’s existing scalar schedule. The final tick uses alpha about 0.001023; the next alpha is 0.001. This does not reproduce Graph’s wall-clock scheduler. **Collision cooling exponent stays 0**, so collision continues at full strength while gravity, center, repulsion and springs cool. The schedule and collision’s optional alpha exponent are separate controls.

| Dense topology / 4 passes | WebGL tick / trajectory passes | WebGPU tick / trajectory passes | Final raw drift: WebGL / WebGPU | Final aligned drift: WebGL / WebGPU |
| --- | --- | --- | --- | --- |
| Chain | 298 / 0 | 300 / 1 | 29.013% / 23.277% | 28.981% / 23.143% |
| Communities | 293 / 0 | 300 / 1 | 32.594% / 28.286% | 31.609% / 27.067% |
| Star | 286 / 0 | **299 / 1** | 148.481% / 138.051% | 113.761% / 126.221% |

Counts are out of 300; percentages use CPU RMS radius. All paths stay finite. Movement becomes much smaller than in the full-strength runs, while independent coordinate disagreement remains.

| Cooled dense fixture | Radius: CPU / WebGPU / WebGL | Stress RMS: CPU / WebGPU / WebGL | Final motion RMS: CPU / WebGPU / WebGL |
| --- | --- | --- | --- |
| Chain | 77.792 / 77.304 / 77.647 | 0.9103 / 0.9106 / 0.9125 | 0.00646 / 0.00517 / 0.00576 |
| Communities | 78.272 / 78.924 / 78.874 | 0.7431 / 0.7463 / 0.7418 | 0.00712 / 0.00647 / 0.00834 |
| Star | 62.190 / 62.260 / 62.221 | 0.4450 / 0.4511 / 0.4387 | 0.07144 / 0.06294 / 0.06089 |

Radius and motion are in world units. Stress uses the existing scale-fitted graph-distance metric, with 16 deterministic landmarks for 512 points. It fits scale separately for each layout. Aligned drift removes translation and rotation only: it does not rescale, reflect or reassign point identities. These describe geometry; there is no new quality acceptance threshold.

Residual overlap also remains. Cooled chain maximum penetration is CPU **0.601**, WebGPU **0.411**, WebGL **0.498** world units. For communities it is **0.761 / 0.456 / 1.050**, and for star **2.451 / 2.893 / 2.604**. Four passes and a cooling schedule do not establish an overlap-free result.

## The new cooled-star failure

At tick **5**, alpha **0.9120108393559097**, the native WebGPU path fails **two whole-tick coordinates**, maximum error **0.1319580078125**. Every local stage gate passes.

Gravity, corrected center, exact repulsion and both spring stages have **zero local force and position error** at that tick. The first difference appears in the first collision pass: force error **0.00000286102294921875**, followed by a [one-ULP](#/vocabulary/ulp) position difference of **0.000244140625**. Subsequent collision passes amplify the changed intermediate state. This is distinct from the earlier float32 center-tree failure.

The native regression reconstructs this native trajectory’s input to tick 5, then compares native and strict collision kernels from **that same frozen input and alpha**. Switching only to the strict collision kernel makes the complete tick pass the unchanged gates. No CPU intermediate is substituted. This supports a focused collision-arithmetic investigation; it does not establish a whole independently evolving strict trajectory or justify adopting that kernel’s cost as production policy.

Across all **1,600 combined ticks**, the corrected WebGPU center aggregate, force and integrated position have **zero local error** against the CPU calculation on the GPU’s actual input. The center fix continues to work in this tested envelope. The new whole-tick failure is retained, rather than absorbed into the trajectory-drift metrics.

## Controls and replay

Two additional 100-tick controls pass both GPU tick and trajectory gates throughout:

- **128 uniform points, isolated collision, one pass, fixed alpha 1.** Both GPU paths end about **0.000109** world units RMS from CPU, within the original coordinate budget.
- **8 masked points, combined star, four passes, 100-tick cooling.** Both GPUs end at zero RMS drift. Pins and absence remain intact. The one remaining overlap is between two pinned discs, maximum penetration 5.5.

Together with the larger matrix, this is **1,700 ticks per GPU**. The 26 recorded tick/trajectory failure replays all reproduce their captured output bits and restore live positions. A trajectory capture stores the GPU’s own starting input and the corresponding independently evolved CPU output. Replaying it against a fresh CPU tick from the GPU’s input would test a different question. Cooled captures retain their original alpha; replay advances neither CPU state nor cooling.

Native checks verify that independent ordinary ticks never call the position-reset upload, a deliberately perturbed GPU lane keeps its own history, masks survive all three topologies, and replay restores state before continuation. The focused collision/combined suite passes **91 tests**, including the same-input cooled-star arithmetic control.

## Reproduce

Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open [Collision constraints](#/collision).

1. Choose **Combined forces → Independent layouts**, native collision arithmetic and **High/low sum · corrected**.
2. For the full-strength matrix, choose uniform / 128 / one pass, then clusters / 512 / four passes. Run each topology for **100 validated ticks** with **Fixed alpha**.
3. For cooled dense cases, choose **Cool over 300 ticks** and **Run cooling schedule**. Each setting change resets to the same deterministic fixture. A completed schedule stops at its selected tick count; reset to rerun it.
4. Inspect tick gates, trajectory gates, raw/aligned drift, overlap and the two charts. Use **Replay failures** after the run; export JSON for local analysis.
5. For semantic controls, run masks / combined star / four passes / 100-tick cooling, then uniform / 128 / collision only / one pass / fixed alpha.

Run `LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/collision` for the bounded native checks. `independent.test.ts` covers state retention, cooling and replay; `independent-composition.test.ts` reconstructs the cooled-star input and compares collision arithmetic.

JSON captures stay local; this page preserves the findings, environment, settings and reproduction steps. Existing GPU-cost buttons still measure frozen CPU geometry separately, using the current alpha. No GPU speed claim is inferred from validation elapsed time.

The [targeted collision correction](#/collision/docs/precision) now closes the captured tick and repeated matrix at the same gates, with paired GPU cost. Larger collision hashing/slots, wider inputs, full Graph scheduling and native portability remain open. Similar aggregate layout scores alone are insufficient to declare trajectory parity or visual-quality acceptance.
