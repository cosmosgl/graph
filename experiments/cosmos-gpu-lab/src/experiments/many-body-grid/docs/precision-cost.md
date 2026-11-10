## Preserving precision with less memory

**Streaming one hierarchy level at a time cuts the correction's extra storage by about 80%, with comparable GPU
time in the checked cases.** Both corrected variants passed every checked batch in two standalone Chrome sweeps on
Apple M3. Complete-step medians ranged from about 3% faster to 7% slower for streaming, and sample ranges overlapped.
There is no consistent speed winner. The memory reduction is the useful result.

This follows the [far-field precision investigation](#/many-body-grid/docs/far-field). The original inline path
remains the default and a timing control. It fails dense CPU parity, so its lower time does not make it an eligible
replacement for the corrected variants. Production Cosmos is unchanged.

## Reuse the scratch buffer, preserve the sum

The full-buffer candidate stores 100 possible cell contributions per target **for every level** before accumulating
them. Streaming needs only one level's contributions at a time:

```flow
Build hierarchy and corrected centroids · Same data and arithmetic as the full-buffer candidate
Write one level's contributions · Round each completed force pair into reusable float32 scratch storage
Accumulate that level · Sum cells in the original order, then add that level total to the preceding cumulative sum
Repeat for the next level · Reuse scratch; retain the much smaller cumulative sums for diagnosis
Finish the force · Add the unchanged near-field force, then integrate
```

The refined square, division and square-root arithmetic is unchanged. As in the original shader, each level sums
its cell contributions from zero, then adds that total to the preceding levels' cumulative sum. Both the cell order
and the grouping by level are preserved. Producer and consumer use the same population tests and cell traversal,
so stale scratch slots are never read.

| Points | Full-buffer extra storage | Streamed extra storage | Reduction |
| ---: | ---: | ---: | ---: |
| 8,192 | 38.83 MiB | **7.96 MiB** | 79.5% |
| 16,384 | 76.33 MiB | **14.58 MiB** | 80.9% |

These counts have six hierarchy levels. Full-buffer storage is `N × 6 × 100 × 8` bytes for contributions plus
1.33 MiB for centroids. Streaming uses `N × 100 × 8` bytes of scratch, `N × 6 × 8` bytes for cumulative sums,
and the same centroids. The table counts extra storage buffers relative to inline, not all device memory;
small per-level uniforms and temporary diagnostic buffers are excluded.

The tradeoff is **13 extra dispatches instead of 2**: one centroid dispatch, then a producer and accumulator for
each of six levels. All grid and force dispatches share one luma compute pass; integration has its own pass.
Separate dispatches retain the required storage rounding boundaries. WebGPU treats each compute dispatch as a
separate resource usage scope, allowing this producer–consumer sequence inside a pass. See
[WebGPU synchronization](https://www.w3.org/TR/webgpu/#synchronization).

Initial instrumentation with separate compute passes triggered a Metal command-buffer insufficient-memory failure
on this machine, even on a small input. The shared-pass organization completed both native sweeps. This establishes
a working configuration here, not the root cause of that native failure or a general rule about Metal. All three
timed variants use the same pass organization.

## Native timing results

Standalone Chrome, Apple M3, luma.gl 10.0.0-alpha.4; eight samples per cell, precise shell, tick-zero bounds and seed.
Two runs used the same sweep settings, with no GPU regression suite running concurrently. Values below are complete
step **median GPU milliseconds per operation**, including hierarchy construction, force and integration.

| Fixture / points | Run | Inline control | Full buffer | Streamed |
| --- | ---: | ---: | ---: | ---: |
| Uniform / 8,192 | 1 | 3.375 | 5.587 | 5.423 |
| Uniform / 8,192 | 2 | 2.343 | 3.408 | 3.588 |
| Uniform / 16,384 | 1 | 3.719 | 6.177 | 6.242 |
| Uniform / 16,384 | 2 | 3.834 | 6.128 | 5.997 |
| Clusters / 8,192 | 1 | 3.998† | 5.292 | 5.620 |
| Clusters / 8,192 | 2 | 2.769† | 3.228 | 3.375 |
| Clusters / 16,384 | 1 | 4.309† | 5.046 | 5.390 |
| Clusters / 16,384 | 2 | 3.752† | 4.555 | 4.653 |

† Inline fails the original dense CPU-reference check. Both corrected candidates pass all checked batches.

Variation is substantial. For uniform 8,192, full-buffer / streamed sample ranges were **4.620–6.554 / 4.882–5.997 ms**
in run 1 and **3.293–4.096 / 3.293–4.227 ms** in run 2. For clustered 16,384, they were
**4.669–6.586 / 4.702–6.963 ms** and **4.440–4.653 / 4.620–4.964 ms**. These ranges overlap; a small median
difference is not evidence of a durable advantage. Absolute timing should be reproduced on the target machine.

The force-only interval includes hierarchy construction and all force dispatches, excluding integration:

| Fixture / points | Run | Inline control | Full buffer | Streamed |
| --- | ---: | ---: | ---: | ---: |
| Uniform / 8,192 | 1 | 3.408 | 5.833 | 5.538 |
| Uniform / 8,192 | 2 | 2.343 | 3.473 | 3.588 |
| Uniform / 16,384 | 1 | 4.178 | 6.750 | 6.390 |
| Uniform / 16,384 | 2 | 3.621 | 6.078 | 6.095 |
| Clusters / 8,192 | 1 | 3.850† | 5.063 | 5.243 |
| Clusters / 8,192 | 2 | 1.835† | 2.376 | 2.441 |
| Clusters / 16,384 | 1 | 4.735† | 5.833 | 5.521 |
| Clusters / 16,384 | 2 | 3.670† | 4.669 | 4.833 |

The two stages are measured separately, with changing scheduling and system conditions. Subtracting their medians
does not estimate integration cost. These measurements include the experiment's diagnostic dense-cell builder;
they are neither isolated far-field arithmetic timings nor production frame rates.

## Measurement and correctness contract

Each case creates independent backends for inline, full-buffer and streamed execution. One-operation pilots select
a common batch size using the slowest variant, targeting 6 ms with a 4–64 operation bound. Both native runs selected
four operations. Each stage then uses two warmups and seven measured samples, rotating the first variant each round.

Every operation repeats the same resident input positions. GPU timestamps surround the first through last operation;
uploads, rendering, readback and CPU validation are outside that interval. GPU completion is awaited between batches.
CPU submission and completion times are exported separately and never substituted for GPU time. Missing, invalid or
zero GPU durations do not produce a valid GPU median.

The independent CPU oracle and original `2e−5 + 3e−5 × |reference|` tolerance are unchanged. Every pilot, warmup and
sample checks forces and positions. Structure and exact centroid checks bracket each stage. A corrected candidate's
failure stops the sweep and remains exportable; inline's known mismatch stays visibly marked beside its timings.
Cancellation retains partial samples without presenting them as a completed seven-sample result.

The regression suite additionally checks both corrected candidates on three CPU-anchored dense ticks at both sizes,
both shell qualities, coincident points, absent/pinned points and boundaries. Those trajectory checks use software
Chromium; the native timing runs validate repeated fixed inputs. Neither establishes independently evolving layout
convergence across GPU vendors.

## Reproduce

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid src/experiments/many-body
```

Open **Hierarchical global repulsion → Demo → Benchmark precision** in a WebGPU browser. Keep the tab visible.
The sweep always uses uniform and clustered inputs at 8,192 and 16,384 points, eight samples and precise quality,
independently of the demo controls. **Stop** cancels between batches; **Export JSON** retains completed and partial
rows under `precisionTimings`, with settings, device, raw samples, validation and resource costs. A stopped-on-error
run also includes `precisionTimingError`. Keep captures local; share findings and reproduction settings in Markdown.

**Compare centroid pass** also includes the streamed candidate, its force-stage replay and CPU verdict; exports put
it under `centroidComparison.streamed`. Use this to inspect arithmetic independently of timing.

## What this means for Cosmos

The precision correction no longer needs six full contribution buffers. That makes it a more useful experimental
candidate, but the remaining scratch allocation still grows with point count and the lab caps this experiment at
16,384 points. Both corrected paths cost more than inline in these measurements. The follow-up [independent trajectory experiment](#/repulsion-trajectories/docs/findings) now checks 20 evolving
ticks, including both dense sizes on M3. Combined-force behavior and replacing diagnostic construction with a scalable
hierarchy builder remain open.
Broader device evidence is needed before choosing a production precision policy.
