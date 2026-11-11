## Scaling the corrected springs to 8,192 points

The targeted spring correction passes **all 126 scheduled WebGPU checkpoints** at 8,192 points, but the
full-strength probe after the 100-tick star schedule fails the whole-tick budget in two components.
The 300-tick star probe passes. The acceptance gate therefore **does not pass**, and 32,768-point testing is held.
All tolerances and reference arithmetic remain unchanged.

This extends [Targeted rounding](#/combined-layout/docs/spring-products), using **Distance + rounded products**,
native Chrome 157 and Apple M3 on 11 November 2026. Both production WebGL and WebGPU evolve independently
alongside the CPU trajectory. Hierarchical repulsion is used throughout this experiment.

The follow-up [tick-precision investigation](#/combined-layout/docs/tick-rounding) isolates repulsion-integration
rounding and gravity evaluation order. Its diagnostic candidate fixes both star schedules but regresses the
communities tick-1 whole-tick check. The subsequent [gravity-math correction](#/combined-layout/docs/gravity-trig) passes the full 8,192-point
M3 matrix with the original budget, at a measurable gravity cost. The original controls below retain their failures.

## Correctness results

| Graph | Cooling schedule | Scheduled WebGPU checkpoints | Full-strength WebGPU probe | Failed WebGL checkpoints |
| --- | ---: | ---: | --- | ---: |
| Chain | 100 ticks | 11 / 11 pass | Pass | 1 |
| Chain | 300 ticks | 31 / 31 pass | Pass | 2 |
| Communities | 100 ticks | 11 / 11 pass | Pass | 2 |
| Communities | 300 ticks | 31 / 31 pass | Pass | 6 |
| Star | 100 ticks | 11 / 11 pass | **FAIL: whole tick, 2 components** | 2 |
| Star | 300 ticks | 31 / 31 pass | Pass | 3 |

Checkpoints are tick 1, every tenth tick and the final tick. Each checks gravity, repulsion, both directional
spring forces and integrations, the hierarchy, centroids and the complete tick from that backend's starting
positions. Intermediate ticks remain unvalidated. All trajectories remain finite, with no backend setup or
execution errors. WebGL's existing numerical failures remain recorded separately.

First failures were replayed on their original inputs and the current layouts restored. All 12 first-failure
replays reproduce their checks and output bits exactly, including the WebGPU star probe. WebGL probes pass only
for the 300-tick chain in this set; the others fail. These results describe the deterministic fixtures on M3.

## What fails in the star

After 100 cooling ticks, the probe evaluates one additional tick at alpha 1 without changing the cooled layout.
Every individual WebGPU stage passes. Incoming and outgoing spring force and position buffers match their
stage CPU references exactly. Hierarchy and centroid validation also pass. Nevertheless, the complete tick,
evaluated from a shared starting state, differs beyond its budget in two output components.

Stage checks predict each operation from its actual GPU input. The whole-tick check instead runs the CPU's
entire sequence from the tick's original input. Small acceptable differences earlier in the sequence can
propagate through later forces. The failure shows that local stage agreement does not establish whole-tick
agreement. It does **not** identify the first divergent operation; that needs a replay of the composed sequence.

The repeated probe isolates these two x coordinates:

| Point | GPU x | CPU x | Absolute error | Allowed budget |
| --- | ---: | ---: | ---: | ---: |
| 43 | −0.09372711181640625 | −0.0937042236328125 | 2.288818e−5 | 2.281113e−5 |
| 4424 | −0.06417083740234375 | −0.0641937255859375 | 2.288818e−5 | 2.192581e−5 |

The largest whole-tick absolute difference is 2.288818e−5. The pass/fail decision uses each component's existing
absolute-plus-relative budget, rather than that global maximum. The 300-tick probe passes its budget, so the
failure depends on the state reached by the cooling trajectory.

Cooling also remains distinct from settling: star RMS motion is 0.00197 at the end of the 100-tick schedule,
then 41.12 in the full-strength probe. The 300-tick schedule gives 0.000737 and 41.80 respectively.
Passing arithmetic checks does not establish an equilibrium layout.

## GPU spring cost

The star's hub was measured first. Every row uses repeated frozen initial CPU inputs at alpha 1, two warmups,
seven measured batches and rotated mode order. The luma GPU timestamps include the directional force and
integration passes. Upload, compilation, readback, CPU reference calculation, validation and rendering are
outside the interval. These are **spring-pass times**, not complete simulation ticks or FPS.

Above 2,048 points, the UI now also includes the aligned gravity/repulsion diagnostic. The measurements here compare native f32 and the original product candidate. The expensive full-arithmetic
controls remain available in the earlier small-graph studies. Force-only measurements are retained in the local
export and test output; the table below shows force plus integration, in **milliseconds per operation**.

| Graph / direction | Native WebGPU median (min–max) | Corrected WebGPU median (min–max) |
| --- | ---: | ---: |
| Chain / incoming | 0.0052 (0.0051–0.0067) | 0.0357 (0.0314–0.0627) |
| Chain / outgoing | 0.0154 (0.0087–0.0613) | 0.0843 (0.0529–0.1530) |
| Communities / incoming | 0.0084 (0.0083–0.0240) | 0.0633 (0.0628–0.0829) |
| Communities / outgoing | 0.0173 (0.0171–0.0176) | 0.1069 (0.1065–0.1607) |
| Star / incoming hub | 2.0833 (2.0610–2.3039) | **6.9866 (6.9253–7.1648)** |
| Star / outgoing leaves | 0.0043 (0.0042–0.0264) | 0.0249 (0.0246–0.0271) |

All 12 corrected force-only and force-plus-integration rows pass every batch validation: 84 measured batches
and 120 checks including pilots and warmups. Every row has seven valid timestamp samples. Native f32 fails four
force-plus-integration rows and is retained as a timing control: chain incoming, both communities directions,
and star outgoing. All native force-only rows pass.

The corrected star hub costs about 3.35× native f32. Its roughly fourfold increase from the earlier 2,048-point
measurement is consistent with the serial neighbor loop. Chain and communities distribute the work more broadly;
their short kernels also show more timing variability. This timing set does not measure WebGL GPU cost or other adapters.

## Reproduce and inspect

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Combined layout convergence**.
2. Select 8,192 points, **Distance + rounded products**, and checkpoint every 10 ticks. Run chain, communities
   and star with 100- and 300-tick schedules. Run **Probe at α = 1** after each schedule.
3. Inspect the individual stage checks and whole-tick row. For the 100-tick star, use **Replay first failures**:
   `probe-webgpu` should reproduce with zero differing output components and successful restoration.
4. Use **Time spring arithmetic** for each graph. Keep other GPU workloads idle. **Export JSON** preserves
   local measurements and captured failures; those machine-specific exports are not committed.

Run the opt-in native research suite:

```sh
LAB_NATIVE_GPU=1 LAB_SCALE_COUNT=8192 LAB_SCALE_PRECISION=products pnpm --filter @cosmos.gl/gpu-lab test:gpu scaling.test.ts
```

On the measured M3, this intentionally returns a failing acceptance result for the star's 100-tick probe.
The test does not convert that known failure into a passing assertion. The regular regression suite skips
these larger research cases unless the native GPU and explicit size are requested.

After resolving the acceptance failure, measure the next size before starting trajectories:

```sh
LAB_NATIVE_GPU=1 LAB_SCALE_COUNT=32768 pnpm --filter @cosmos.gl/gpu-lab test:gpu scaling.test.ts -t 'spring GPU cost'
```

That measurement starts with the serial star hub. Inspect its time, range and validation first, then decide
whether to run the 32,768-point trajectories. **No 32,768-point result is established by this study.**
