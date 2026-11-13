## Historical topology sweep — superseded WebGL baseline

**These timings do not establish a Cosmos → WebGPU speedup.** The raw-WebGL prototype used one
spring program bounded by maximum total degree for both directions. Production Cosmos compiles two
programs with independent directional maxima. The old baseline therefore included unnecessary loop
work, especially on outward stars, even though its numerical results passed.

The current backend uses luma `Model`, `UniformStore` and render passes with corrected directional
bounds. Its exports carry `luma-model-directional-v1`. The historical values below remain as an
investigation record, not measurements of the corrected implementation. Rerun the paired sweep before
making performance claims; do not combine old and new samples.

The recorded runs were on **9 November 2026**, Apple M3, Chrome 156 in the desktop in-app browser,
WebGL via ANGLE Metal and native WebGPU, with both GPU timers available and luma `10.0.0-alpha.4`.

## Workloads and validation

The sweep covers 1,000, 10,000, 50,000 and 100,000 points, with four topologies at each size:

- Chain: maximum degree 2.
- Star: one point connects to every other point; maximum degree V−1.
- Clusters: disconnected groups of up to 32 points. A repeated intra-cluster edge at group boundaries
  keeps the total edge count equal to the other fixtures.
- Hubs: edges distributed across four high-degree points, with a short chain connecting those hubs.

Each case has **E = V−1**, identical initial positions and the same deterministic weight sequence. Only
endpoints change. Changing endpoints also changes rendered line lengths and overdraw; the isolated force
and render timings help distinguish those effects. The camera is fixed at 480×340, with five-pixel circles
and one-pixel lines. Rendering is intentionally minimal.

Validation evolves a separate CPU simulation for **25 ticks**, checking every component of both forces
and both integration outputs at ticks **1, 10 and 25**. Both backends are also compared directly when run
together. The CPU builds its own JavaScript adjacency lists from original edge IDs; it does not read the
GPU CSR or its precomputed coefficients. The acceptance rule remains
`abs(actual − expected) ≤ 2e−6 + 2e−5 × abs(expected)`.

Across the runs below, all 16 topology/size combinations passed these checks on each backend. Fifteen had
paired WebGL/WebGPU checks; the 100k star passed CPU checks on each backend in separate isolated runs.
The largest observed component error was about `1.2 × 10⁻⁷`. These short trajectories support semantic
compatibility; they do not establish long-term convergence with Cosmos's other forces enabled.

## Historical raw-prototype full ticks

Median GPU interval time in milliseconds per complete experimental tick:

| Points | Topology | Old raw WebGL | WebGPU |
| --- | --- | ---: | ---: |
| 1,000 | Chain | 0.301 | 0.219 |
| 1,000 | Star | 1.377 | 0.655 |
| 1,000 | Clusters | 0.282 | 0.092 |
| 1,000 | Four hubs | 0.548 | 0.185 |
| 10,000 | Chain | 1.920 | 1.409 |
| 10,000 | Star | 9.613 | 3.539 |
| 10,000 | Clusters | 0.623 | 0.405 |
| 10,000 | Four hubs | 3.115 | 1.245 |
| 50,000 | Chain | 5.276 | 5.833 |
| 50,000 | Star | 73.092 | 17.302 |
| 50,000 | Clusters | 3.920 | 5.505 |
| 50,000 | Four hubs | 21.710 | 7.733 |
| 100,000 | Chain¹ | 5.695 | 6.619 |
| 100,000 | Star² | unavailable | 36.504 |
| 100,000 | Clusters | 4.944 | 7.143 |
| 100,000 | Four hubs | 60.507 | 15.335 |

¹ The chain was completed in a separate paired run after the original sweep stopped.
² WebGPU-only run. WebGL lost its context during the isolated rendering stage, after validation and
force/integration timing had completed. No complete WebGL tick timing is reported for this case.
The other rows are from one complete-range attempt; do not interpret them as a multi-run average.

An earlier 1k–10k run showed the same broad topology effect, with visible timing variation: the 10k star
was 9.55/3.34 ms (WebGL/WebGPU), while the 10k chain was 2.37/1.90 ms. Small differences between rows or
runs are not a stable ranking across hardware, browser load or GPU clock states.

## Historical stage observations

Selected isolated stages, measured separately from complete ticks:

| Workload | Stage | WebGL GPU ms | WebGPU GPU ms |
| --- | --- | ---: | ---: |
| 50k star | Both directional springs | 40.495 | 14.746 |
| 100k four hubs | Both directional springs | 27.240 | 11.993 |
| 100k chain | Both directional springs | 0.540 | 0.162 |
| 100k chain | Both integrations | 0.332 | 0.083 |
| 100k chain | Points + links | 4.937 | 5.964 |
| 100k clusters | Points + links | 3.643 | 4.588 |
| 100k star, isolated runs | Both directional springs | 120.032 | 31.523 |

**A single giant hub still has a serial dependency.** The WebGPU
100k star's spring stage alone takes about 31.5 ms. Each neighbor sees the displacement accumulated
from previous neighbors; replacing that ordered walk with an ordinary parallel reduction would change
Cosmos semantics.

**Low-degree graphs expose the renderer.** On the 100k chain, compute and integration are small relative
to drawing. The current WebGPU circle/line renderer is slower in the observed full tick despite faster
compute. Rendering changes deserve their own comparison before assuming a complete-engine win.

**Topology should be reused.** CPU CSR construction was around 7–8 ms at 100k points in these runs.
It happens on connectivity replacement, not each tick. Resource recreation/upload is recorded separately;
it includes packing, allocation and, on WebGL, program setup. The upload-call metric is CPU API time,
not isolated GPU transfer time. These demo setup costs are not a production incremental-update benchmark.

Isolated stages do **not** add up reliably to the complete tick: they run in separate intervals with
potentially different batch sizes, cache state, GPU clocks and driver scheduling. Use the directly measured
complete tick for full-workload conclusions.

## The 100k-star failure

**Follow-up:** [render isolation and the spring-loop investigation](#/weighted-links/docs/context-loss)
show that the initial 100k-star geometry renders successfully without simulation. The render timing
path also prepares a spring tick before its query, so the original failure phase does not establish
that drawing caused the reset. An early-exit spring variant also failed in a native paired retry after a browser restart,
before any validation snapshot or timing sample. Later isolation passed every simulation pass and a grouped tick on each backend, but WebGL alone
still failed at tick 1 in the trajectory runner. The fence-based trajectory passed once, then failed on repeat. Finer checkpoints first observed loss
in the browser event after all four snapshot reads returned.
The cause remains unresolved in the old raw prototype. These traces do not establish a failure in
production Cosmos or in the corrected luma baseline.

The first combined sweep stopped at the 100k star with
`A valid external Instance reference no longer exists`. That message alone does not identify a faulty
shader: similar failures are tracked in [Chromium's WebGPU issue tracker](https://issues.chromium.org/issues/350775867).

After recreating devices, WebGPU alone completed validation and all timing stages. WebGL alone completed
25-tick validation, force timing and integration timing, then reported `WebGL context lost during timing`
while the render stage was running. This narrows the observed failure to that WebGL workload; the underlying
browser/driver cause remains unresolved. It is not a tolerance failure or a universal 100k-point limit.

The runner keeps completed rows and stops on a device/context error. Export them before restarting devices.
It does not silently retry a failed case or publish a zero time. The largest star now runs last so a failure
does not prevent collecting the other topologies. A rerun may reproduce this loss on the tested setup.

## Reproduce

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open [Weighted link forces](#/weighted-links).
2. Leave the collision rest-length floor off, with the default spring parameters.
3. Choose **Both**, **All four** topologies and **All in range** in the sweep filters.
4. Run **Sweep 1k–10k** first, then **Sweep 1k–100k**. Stop cancels between GPU operations and retains completed work.
5. To isolate a case, select a backend, topology and point count, then choose the sweep range containing it.
6. Use **Export JSON** for raw batch samples, timer validity, setup costs, parameters, validation and any error phase.
   Keep these captures local; share conclusions in Markdown rather than committing measurement files or archives.

Select **Cosmos directional bounds** for the corrected baseline. The historical raw implementation is
no longer a selectable benchmark mode.

The full-range sweep has 16 cases. Backend order alternates during sampling. Timing is gated by validation,
then calibrated to a shared batch size targeting 6 ms, capped at 64 operations, with two warmups and seven
measured samples per stage. Slow cases naturally use one operation; their work already exceeds the target.
See the [timing contract](#/weighted-links/docs/results) for frozen-input and query semantics.

The next migration decision requires new measurements of the corrected baseline, separating spring
compute from renderer cost. Keep the old context-loss traces as historical evidence only.
