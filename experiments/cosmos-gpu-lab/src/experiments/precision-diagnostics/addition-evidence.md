# Addition-order evidence

On **12 November 2026**, a cancellation input showed how float32 rounding changes a sum.
The exact sum of the 1,024 input integers was **512**. CPU float32 models and WebGPU
returned the same observed values for each addition order:

| Addition order | CPU | WebGPU | Exact sum |
| --- | ---: | ---: | ---: |
| One at a time | 1 | 1 | 512 |
| Groups of 64 | 16 | 16 | 512 |
| Tree of 256 partial sums | 512 | 512 | 512 |

The input repeated `16777216, 1, -16777216, 1`. These are bounded integers, so their
JavaScript double-precision sum is exact. The recorded session used an Apple M3 host,
headless Chrome 157 and luma 10.0.0-alpha.4; WebGPU reported an Apple adapter.
No source revision was recorded for this session. The original study also tested 257
and 4,096 inputs and positive and balanced controls.

## The same numbers in a different order

On **18 November 2026**, a follow-up rearranged the same 1,024 values. The exact sum
remained 512, but the CPU and WebGPU tree returned **512** for the repeating order
and **256** for the grouped order. Each GPU order ran four times in one session;
positive controls returned the exact sum. GPU intermediate values were not captured,
so the observation does not establish the precise cause of the GPU difference.

That session reported headless Chrome 157, luma 10.0.0-alpha.15 and a non-fallback
Apple WebGPU adapter with `metal-3` architecture; its adapter model and backend were
not reported. The source was revision `531d1fab66f3cddae3e39979c3e48dc1132e3e95`
with the retained `fixtures/precision-order-followup.patch`.

These observations do not make the tree universally exact or establish behavior on
other devices. Gravity, layout quality, runtime performance and production readiness
were not assessed by the addition-order follow-up.
