## Fixing the distance-only counterexample

**Distance + rounded products** fixes the remaining captured mismatch without changing the tolerance.
On Apple M3, it also passes the larger trajectory matrix and reduces the 2,048-point star hub spring pass
from 67.32 ms with refined arithmetic to **1.74 ms**. Native f32 remains the default comparison baseline;
this is a tested candidate, not a portable arithmetic guarantee or a production migration.

## The failing coordinate

The distance-only mode fails outgoing springs at tick 10 of the 2,048-point communities / 100-tick schedule.
Point 2031 has two neighbors in that directional gather. Its x position nearly cancels the spring movement:

| Quantity | Distance-only GPU | Stepwise float32 CPU |
| --- | ---: | ---: |
| Input x | −37.682220458984375 | −37.682220458984375 |
| Spring force x | 44.36819076538086 | 44.368194580078125 |
| Integrated x | 0.030742645263671875 | 0.0307464599609375 |

The force differs by one ULP. The position error is **3.814697e−6**, exceeding the unchanged component budget
of **2.614929e−6**. The force and whole-tick checks pass; the intermediate spring-position check catches the error.
Alpha is 0.5370317963702526, uploaded as float32. Rounded integration alone cannot recover a force already rounded differently.

## Isolate with identical inputs

**Isolate spring error** replays the first captured distance-only WebGPU spring failure on a separate luma device.
It checks that the uninstrumented replay matches the original force and position buffers bit for bit, then changes
only selected multiplications. Each row uses the same captured input and CPU expectation, with rounded integration.

| Rounded products inside the spring force | Force components outside budget | Position components outside budget | Maximum position error across the stage |
| --- | ---: | ---: | ---: |
| None: original distance-only | 0 | 1 | 7.629395e−6 |
| Scale chain only | 0 | 0 | 7.629395e−6 |
| Final delta × scale only | 0 | 1 | 7.629395e−6 |
| Both groups | 0 | 0 | 0 |

The maximum error can exceed the failing point's error while remaining acceptable: each component has its own
absolute-plus-relative budget. Rounding the scale chain removes the counterexample; rounding both groups makes
this entire captured stage bit-exact. Only the combined product correction received the full trajectory validation below.

There is a diagnostic trap here. Exporting intermediate values to a storage buffer changes the compiled arithmetic:
the instrumented shader matches the CPU at this point and no longer matches the original output buffers. The UI
reports that discrepancy explicitly. Those intermediate values **cannot identify the first differing instruction in
the original shader**. The uninstrumented ablations provide the causal evidence for correcting the scale products.

WGSL allows reassociation and fusion; an expression with the same exact-real result may produce a different rounded
result. Our evidence is consistent with that behavior, but does not identify a particular Metal instruction or compiler
transformation. See [WGSL reassociation and fusion](https://www.w3.org/TR/WGSL/#reassociation-and-fusion).

## The targeted correction

The new candidate retains rounded distance squares, residual-corrected square root/division and luma's rounded
spring integration. It adds explicitly rounded products for the scale chain and final contributions:

```wgsl
length = roundedProduct(length, roundedProduct(params.spring, params.alpha));
length = roundedProduct(length, edge.strength);
length = roundedProduct(length, edge.bias);
velocity += vec2(roundedProduct(delta.x, length), roundedProduct(delta.y, length));
```

`roundedProduct` generalizes the existing rounded-square helper. It decodes the two float32 significands, multiplies
their 24 bits using 12-bit integer limbs, and rounds the 48-bit product to nearest, ties to even. Reconstructing the
float32 bits establishes an explicit rounding boundary without evaluating a complete fp64 expansion at every edge.
The GPU bit test covers 8,192 deterministic normal input pairs plus eight halfway cases against `Math.fround(a * b)`.
Binary64 can exactly represent the product of two binary32 significands before that final rounding.

This helper targets finite-normal inputs and a normal product range. It falls back to native multiplication for
zero, subnormal, non-finite, underflow or overflow cases. The residual root/division and remaining native additions
still require adapter-specific validation. The experiment uses fixed unit weights and rest-distance variation;
it does not validate every production spring option. All devices, buffers, dispatches and readbacks use luma APIs.

## Validation and GPU cost · 11 November 2026

Native Chrome on Apple M3 passed **12 trajectories**: chain, star and communities; 512 and 2,048 points; 100 and
300 ticks. That covers **252 scheduled WebGPU checkpoints and 12 full-strength probes**, including hierarchy,
centroid, individual force/integration stages and whole-tick checks. Intermediate ticks remain unvalidated.
The original distance-only counterexample is retained as a negative control. Production WebGL failures remain recorded.

Separate standalone Chrome 156 timings reran all seven modes on 2,048-point stars and communities: 56 rows,
392 measured batches and 560 validations including pilots and warmups. All eight new-candidate rows passed every
batch check. The old distance-only community incoming force-plus-integration row still failed.
The [spring timing method](#/combined-layout/docs/spring-cost) uses fixed CPU inputs, rotated order, two warmups,
seven samples and GPU timestamps; it excludes upload, compilation, validation and readback.

This table is **milliseconds per directional spring force plus integration**, median with min–max range:

| Graph / direction | Fully rounded | Refined divide/root | Distance + products |
| --- | ---: | ---: | ---: |
| Star / incoming hub | 120.340 (120.177–121.307) | 67.322 (67.224–67.437) | **1.737 (1.704–1.999)** |
| Star / outgoing leaves | 0.087 (0.087–0.095) | 0.051 (0.051–0.071) | 0.013 (0.013–0.014) |
| Communities / incoming | 2.294 (1.524–4.669) | 1.425 (0.918–2.802) | 0.058 (0.045–0.111) |
| Communities / outgoing | 0.612 (0.226–1.041) | 0.350 (0.149–0.607) | 0.060 (0.021–0.069) |

The star hub is about 39× faster than refined arithmetic, but still 3.4× its 0.511 ms native baseline and about
2× the rejected 0.885 ms distance-only candidate. Community ranges are broad. These are spring-pass measurements,
not complete simulation ticks, rendering FPS or cross-device performance claims.

The follow-up [8,192-point study](#/combined-layout/docs/scaling) passes scheduled checkpoints but exposes a
whole-tick star-probe failure. The larger acceptance gate is not yet passed.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Combined layout convergence**.
2. Select communities, 2,048 points, 100 ticks, checkpoint every 10, and **Distance-only · diagnostic**.
3. Run the cooling schedule, then **Isolate spring error**. Inspect bit-consistency flags and the four ablations.
4. Select **Distance + rounded products**, rerun, and use **Probe at α = 1**. Keep the original tolerance.
5. Use **Time spring arithmetic** for stars and communities at 2,048 points. Keep the tab visible and avoid other
   GPU workloads. Export JSON for local analysis; machine-specific exports are not committed.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu spring-products.test.ts rounded-product.test.ts
```

The negative-control expectations describe M3 behavior. A different adapter may not reproduce that failure and
needs its own investigation. Next, extend graph size, cooling and production spring options, then repeat on other GPUs.
