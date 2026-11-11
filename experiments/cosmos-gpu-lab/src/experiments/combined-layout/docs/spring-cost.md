## The cost of matching spring arithmetic

A fully rounded spring force and integration passed the larger combined-layout checks without changing the
acceptance budget. The next question is whether that precision is affordable, and which operations need it.
[Spring precision](#/combined-layout/docs/spring-precision) retains the original cancellation evidence.

Refined division and square root reduced the measured 2,048-point star hub pass from **119.4 ms to 67.1 ms** while
passing the same trajectory checks. That is about 44% less GPU time, but still far too costly beside the 0.51 ms baseline.
A more targeted distance-only variant is faster again and fails the unchanged budget; it remains a diagnostic.

The follow-up [targeted product correction](#/combined-layout/docs/spring-products) fixes that counterexample and
passes the expanded M3 matrix at a measured 1.74 ms star hub cost. The measurements below retain the earlier controls.

## A narrower correction

The fifth mode, **Rounded + refined divide / root**, keeps the integer-controlled luma addition, subtraction and
multiplication from the fully rounded control. It replaces only division and square root inside the spring force
with native float32 estimates and a residual correction. The spring integration remains fully rounded.

```wgsl
fn springDiv(a: f32, b: f32) -> f32 {
  let q = a / b;
  return q + fma(-q, b, a) / b;
}
fn springRoot(a: f32) -> f32 {
  if (a == 0.) { return 0.; }
  let q = sqrt(a);
  return q + fma(-q, q, a) / (2. * q);
}
```

For division, `a − q × b` estimates how much the first quotient missed. Dividing that residual by `b` corrects the
quotient. For square root, `a − q²` measures the squared error; dividing by `2q` gives a Newton correction. This is
the same approach used in the lab's refined far-field force. The zero guard avoids dividing by zero for a zero root.

This reduces arithmetic work; it does **not** establish portable correctly-rounded division or square root.
WGSL permits rounding variation, fusion and reassociation, and its `fma` contract does not require every adapter to
provide the behavior of an ideal fused instruction. The experiment must validate the generated shader on each
adapter. See [WGSL floating-point accuracy](https://www.w3.org/TR/WGSL/#floating-point-accuracy) and
[luma's precision techniques](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision).

The original four modes remain available as controls. In particular, **Rounded spring force** omits the explicit
integration correction entirely. A passing isolated capture does not establish that it passes a complete trajectory.

## A rejected distance-only variant

**Distance-only · diagnostic** makes a much smaller change: rounded distance squares, residual-corrected square
root and division, and rounded integration. The remaining edge-loop arithmetic stays native. It uses the existing
finite-normal `roundedSquare` helper; outside that helper's range, native multiplication is the fallback.

It passed the 100- and 300-tick stars and the 300-tick communities on M3, but **failed the 100-tick community case
at tick 10**. The outgoing spring force and whole tick passed their budgets; one outgoing position component did
not. The tolerance was unchanged. It therefore remains a labelled diagnostic, not an accepted replacement, even
where its timing row passes on a different frozen input. A native regression explicitly reproduces this M3
counterexample and verifies that the session captures the failure. Another adapter may produce different rounding;
not reproducing this particular negative control calls for investigation rather than a claim that the adapter is wrong.

## Trajectory validation

On Apple M3 with installed native Chrome 157, both **Rounded spring force** and **Rounded + refined divide / root**
passed the original WebGPU checkpoint, hierarchy, centroid, whole-tick and alpha-1 probe checks for 2,048-point
stars and communities at both 100- and 300-tick schedules. That is 84 scheduled checkpoints and four probes per
candidate. Intermediate ticks were not validated. The fully rounded control's earlier results remain unchanged.
The integration correction can be omitted in this tested set, but that is not a general guarantee for cancellation
or other graphs. The narrower division/root correction also remains adapter-dependent.

## What the timer measures

**Time spring arithmetic** uses the selected graph and point count, independent of the live trajectory and selected
arithmetic mode. It constructs deterministic initial CPU positions immediately before each directional spring pass
in tick 1, after gravity and hierarchical repulsion. The outgoing input includes the CPU incoming-spring update.
Every WebGPU mode receives exactly the same stage input at alpha 1.

```flow
Build initial CPU stage inputs · Outside timing
Create seven luma WebGPU backends · Pipeline compilation and upload outside timing
Pilot each mode · Choose 4–64 repeated operations toward a 6 ms batch
Warm up twice · Rotate execution order across modes
Collect seven samples · Timestamp first pass start through last pass end
Read and validate outputs · Original spring tolerance; outside timing
Report GPU median and range · Normalize each batch by its operation count
```

Each batch repeatedly evaluates the **same** input positions, writing the same output buffer. It does not swap
source and destination, advance cooling or evolve the layout. Force-only and force-plus-integration are separate
measurements, for both incoming and outgoing springs. These four rows per mode represent directional work, not an
entire tick and not rendering. On a star, incoming springs include the serial hub gather; outgoing springs distribute
one edge to each leaf. A global average would conceal that difference.

The benchmark uses luma timestamp queries, command submission and fences. Upload, shader compilation, readback,
CPU prediction and validation are excluded from the GPU interval. CPU submission/completion durations are retained
separately in the JSON; completion time is also shown in the UI. CPU completion is never labelled GPU time.

The pilot chooses a batch size **per mode**: a slow correctness control must not shorten the cheaper candidate's
timer interval. The maximum is 64 operations. Cheap kernels may therefore never reach the 6 ms target, and timer
quantization can be significant. Inspect batch counts and the min–max range as well as the median; zero means below
measurement resolution, not free work. Missing or invalid timestamp results stay unavailable. All seven samples
must have valid timestamps before a GPU summary is shown.

All batches, including pilot and warmup batches, are checked against the independent CPU stage reference. Numerical
failures remain labelled **FAIL** while their timing is retained for diagnosis. A failure is not a successful fast
candidate. Separate devices preserve the demo's layout, cooling and failure captures. Stop works between batches;
partial rows remain exportable, without presenting an incomplete sample set as a complete measurement.

## Native M3 timing findings · 11 November 2026

In standalone Chrome 156 on Apple M3, the six graph/size cases below produced 144 timing rows, 1,008 measured batches
and 1,440 batch validations including pilots and warmups. Every timing row had seven valid timestamp samples.
The fully rounded, force-only rounded and refined candidates passed every frozen-input check. Baseline and
integration-only rounding each failed five force-plus-integration rows; distance-only failed the incoming
2,048-point community row. All rows timing force evaluation without integration passed. Those failures are retained alongside their timings.

This table shows **force plus integration**, in microseconds per directional evaluation. Parentheses give the
minimum–maximum across seven samples. Baseline numbers marked FAIL are performance context, not accepted results.
These initial CPU stage inputs differ from the evolving GPU inputs in earlier trajectory runs; a different failure
set is therefore possible, even at 512 points. The original shaders and tolerance have not changed.

| Graph / points | Direction | Baseline µs / checks | Fully rounded µs (range) | Refined µs (range) |
| --- | --- | --- | --- | --- |
| Chain / 512 | incoming | 20.5 / FAIL | 344 (344–360) | 218 (208–343) |
| Chain / 512 | outgoing | 11.3 / Pass | 332 (323–529) | 334 (194–372) |
| Chain / 2048 | incoming | 12.3 / Pass | 537 (332–577) | 212 (200–384) |
| Chain / 2048 | outgoing | 43 / Pass | 336 (328–537) | 340 (200–384) |
| Communities / 512 | incoming | 24.6 / FAIL | 3,870 (1,470–4,130) | 2,080 (770–2,800) |
| Communities / 512 | outgoing | 12.3 / Pass | 432 (232–751) | 234 (127–461) |
| Communities / 2048 | incoming | 11.3 / FAIL | 1,880 (1,540–4,330) | 996 (878–1,360) |
| Communities / 2048 | outgoing | 13.3 / FAIL | 619 (612–1,060) | 354 (350–354) |
| Star / 512 | incoming | 128 / Pass | 29,900 (29,800–30,000) | 16,800 (16,600–17,100) |
| Star / 512 | outgoing | 3.07 / Pass | 82.9 (82.9–103) | 50.2 (49.2–63.5) |
| Star / 2048 | incoming | 511 / Pass | 119,000 (119,000–121,000) | 67,100 (66,800–67,300) |
| Star / 2048 | outgoing | 3.07 / FAIL | 85 (85–103) | 57.3 (51.2–71.7) |

**The robust improvement is on the star hub.** At 2,048 points, the refined incoming pass fell from 119.4 ms to
67.1 ms, about 44% less GPU time. The earlier five-mode run gave 118.7 ms versus 67.4 ms on the same workload.
At 512 points, it fell from 29.9 ms to 16.8 ms. That is repeatable evidence of a useful decrease in arithmetic cost.
Yet 67 ms for one directional pass is still far above baseline's 0.51 ms: this does not make the correction ready
for interactive high-degree graphs. The hub performs 2,047 ordered, dependent edge updates; its arithmetic cannot
be treated as an unordered sum without changing the spring algorithm.

**Skipping rounded integration is not the main hub saving.** The 2,048-point force-only-rounded incoming pass was
118.0 ms. On the outgoing leaves it was cheaper (73.7 µs versus 85.0 µs fully rounded), but the hub dominates this
graph. The refined outgoing pass measured 57.3 µs; its sample range was 51.2–71.7 µs.

**Small-kernel comparisons remain noisy.** In both chain sizes the outgoing refined and fully rounded medians were
essentially equal, with overlapping ranges; we cannot claim a speedup there. The community runs also had broad
ranges. A single pilot can choose a short batch after a slow observation, and the 64-operation cap keeps cheap
kernels near timestamp resolution. Repeated, longer steady-load measurements are needed for fine-grained decisions.
Do not average these cases into a universal speedup or infer whole-simulation frame rate.

**The fastest narrower variant is still rejected.** Distance-only took about 0.885 ms for the large-star incoming
pass and 30.7 µs for the large-community incoming pass. The latter failed accuracy on the frozen input, and the
community trajectory also failed at tick 10. Its speed is evidence for investigating which remaining arithmetic
operations matter, not a reason to accept it.

The next useful step is to isolate the remaining cancellation error and test a cheaper targeted rounding or
conditional correction. Preserve the fully rounded candidate as the correctness control and the original tolerance.
Baseline remains the default. All results here are bounded to these fixtures and this adapter.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Combined layout convergence** in a native WebGPU browser.
2. Choose chain, communities or star, and 512 or 2048 points. Keep the tab visible and avoid other GPU work.
3. Click **Time spring arithmetic**. No preliminary simulation step or failure capture is required.
4. Inspect both directions and both work types. Check the accuracy column before comparing GPU medians and ranges.
5. Export JSON locally for samples, timer status, batch counts, checks, browser and device information. Repeat runs to
   assess variance; measurements from different machines are not interchangeable. No measurement JSON is committed.
6. For trajectory validation, select a candidate and run 100 and 300 ticks at 2048 points, then **Probe at α = 1**.
   Preserve ten-tick checkpoints and the existing tolerances.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/spring-candidates.test.ts
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/spring-benchmark.test.ts
```

The native tests cover candidate trajectories and ensure a three-operation timing batch preserves its source
positions. Mocked timer tests cover complete samples, unavailable GPU timestamps, setup errors, cancellation and
resource cleanup. Performance numbers are observations, not CI thresholds. The earlier SwiftShader compilation
limitation still applies to the full arithmetic control.
