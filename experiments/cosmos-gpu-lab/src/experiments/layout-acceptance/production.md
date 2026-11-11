## From reference settings to Cosmos defaults

The composed WebGPU force slice now supports **32 starting samples, production
spring-distance variation `[1, 1.2]`, occupancy-driven sampling and selected
5,000-tick cooling runs**. This extends the earlier eight-sample, fixed-spring
reference. Existing numerical tolerances remain unchanged.

These are selected production **parameters**, not a port of the complete Graph
runtime. Fixtures use centered coordinates, explicit unit link weights and one
absent point. Gravity, repulsion, incoming/outgoing springs and cooling run;
center, clusters, attractors, mouse force and collision remain outside this gate.
At the tested sizes, production's automatic far-field quality selects the precise
shell already used here. The larger fast-quality tier is unvalidated.

| Preset | Initial samples | Spring variation | Purpose |
| --- | --- | --- | --- |
| Reference | 8 | `[1, 1]` | Retain the earlier control |
| 32 samples | 32 | `[1, 1]` | Change sampling alone |
| Varied springs | 32 | `[1, 1.2]` | Add the production variation |
| Adaptive | 32, then 8–64 | `[1, 1.2]` | Add occupancy-driven decisions |

## How adaptive sampling works

Occupancy means the number of present points in a cell. A GPU reduction counts
points in finest-level cells fuller than 8, 16 and 32. The controller chooses the
smallest sample count leaving at most **1% of points** in fuller cells, subject
to the production work and memory caps: **1.6 million point-samples** and
**32 MiB** of slot storage, with an eight-sample floor and a 64-sample ceiling.
The initial tier at 8,192 points is 32.

```flow
Aggregate the current finest cells · GPU positions remain resident
Reduce occupancy into 256 blocks · 4 KiB of integer statistics per lane
Validate counts against CPU at the measurement checkpoint · both GPU lanes must agree
Choose the sample count · first result applies; later changes need two agreeing results
Apply the same choice to both variants · retain positions and record the decision
```

Measurements wait at least 30 ticks and apply held-time backoff: the next
measurement is delayed by the read's measured hold divided by `0.01`. Empty
measurements leave the current choice alone. Decisions and their tick indices are
exported. Paired validation changes wall-clock scheduling, so these are the
production **decision rules**, not a claim of identical Graph render-loop timing.

The prototype reserves **64 slots** for adaptive runs. Changing the active count
does not allocate buffers or replace position storage. At 8,192 points the finest
grid is 256²: eight, 32 and 64 planes need 4, 16 and 32 MiB respectively. Adaptive
runs retain the full 32 MiB even when eight planes are active. The measured
baseline application-buffer footprint is about **14.9 MiB** for fixed eight,
**26.9 MiB** for fixed 32 and **42.9 MiB** for the adaptive reserve. These exclude
driver, pipeline and texture memory. Production resizing/trim policy remains open.

Read hold time includes queued GPU work and the transfer; it is not the isolated
occupancy-kernel duration. Measurement ticks add one occupancy dispatch. Frozen
timing trials keep the chosen sample count fixed and do not run the controller.

## A varied spring exposed another rounding boundary

The first 100-tick dense-star run passed with 32 fixed samples, then failed the
full-strength probe after enabling `[1, 1.2]`. One outgoing position exceeded the
original spring budget even though both GPU variants agreed and force tolerance
passed. Automatic acceptance correctly withheld timing for the failing rows.

| Point 4,101 x | Value |
| --- | --- |
| Original GPU result | `0.22846221923828125` |
| CPU reference | `0.2284698486328125` |
| Error | `0.00000762939453125` |
| Original budget | `0.00000656939697265625` |

The replay reduces to two present points while retaining the original edge IDs
and degree bias. Explicitly rounding the random-range product and the subsequent
distance product resolves this counterexample. The correction applies to varied
springs; fixed-spring controls keep their earlier shader path. The regression
retains the captured coordinates and the original tolerance.

## Native M3 acceptance

Chrome 156, luma `10.0.0-alpha.4`, 8,192 points, gravity `0.25`, friction `0.85`,
and the production exact/grid cutoff. Hub prefetch uses a 1,024-neighbor cutoff;
the candidate also enables cached grid IDs and the 32-index sort. Both timed lanes
are WebGPU. Timings below are ordinary compute + minimal-render GPU milliseconds
for a full-strength tick on the final geometry, with four warmup and twelve
measured paired rounds, four restored frames per trial.

All four 100-tick presets pass for chain/uniform, communities/clusters and
star/clusters with point 0 pinned, plus an unpinned star control: **16 rows**.
After the varied-rest correction, the adaptive 300-tick matrix passes all six
graph/density combinations twice, in reverse order for the second block:
**12 rows**, with about **10–27%** lower candidate frame time.

| Selected 5,000-tick adaptive run | Point 0 | Checked ticks | Occupancy reads | Baseline → candidate | Time saved |
| --- | --- | --- | --- | --- | --- |
| Chain, uniform | Pinned | 98 | 48 | 5.71 → 4.90 ms | 14.2% |
| Communities, clusters | Pinned | 98 | 48 | 5.57 → 4.86 ms | 12.8% |
| Star, clusters | Unpinned | 98 | 48 | 14.16 → 10.47 ms | 26.0% |

Each long run reaches alpha approximately `0.001`, then passes a full-strength
probe with all four local-stage gates and independent whole-tick CPU positions.
The dense community and star start at 32 samples, apply 64 after the first
measurement, and return to eight after tick index 400 in these captures. The
chain applies eight after the first measurement. This timing is capture-specific.

Across the **31 accepted rows**: **934 checkpoint ticks**, **1,868 lane tick
checks**, **3,968 normal timing captures** and **992 separate diagnostic captures**
pass. Timing counts include warmups. Every row retires with **0 / 0 tracked buffer
bytes** remaining. The candidate wins 12/12 measured pairs in 30 rows and 11/12
in one 300-tick uniform-chain row. The 5,000-tick results are selected runs, not a
repeated long-run performance sweep or evidence of a complete-engine speedup.

## What a checkpoint proves

The first tick, the selected interval, the last tick and every occupancy
measurement are checked. Each compares ordinary single-pass frame outputs,
staged replays, the original tighter spring budget and an independent CPU
**complete tick from that tick's GPU starting positions**. A final alpha-1 probe
tests the cooled geometry at full force strength.

Between checkpoints both variants evolve on the GPU. At checkpoints only,
diagnostic replay uploads GPU-derived positions and restores each lane's ordinary
output; CPU reference positions never enter the trajectory. This is not an
independently evolved CPU layout over all 5,000 ticks, nor a check of every
intermediate tick. Errors shared by both variants between checked ticks and
layout-quality differences need separate production/CPU trajectory evidence.

When a checkpoint fails, the runner replays from the last trusted GPU state and
checks each tick to locate the first reproduced failure. Export includes stage
input, whole-tick input, actual/expected arrays, alpha and sample count. A native
negative-control test injects a candidate fault at tick index 2: the next sparse
checkpoint catches it and replay locates step 3, with timing withheld. The replay
reports explicitly if a failure does not reproduce.

Retained-buffer tests also cross 4,096/4,097 in both directions with
**position preservation enabled**, including growth back to 8,192. Position
buffer identities and the independent complete-tick CPU gate remain checked.

## Reproduce and continue

Open [Production layout gates](#/layout-acceptance). The **100-tick preset ladder**
runs all four presets with ten-tick checkpoints on the selected graph/density.
Use **Adaptive samples**, **After 300 cooled ticks**, and the graph/density sweep
for the repeated matrix. For a selected long run choose **After 5,000 cooled
ticks** and **Every 100 ticks**; occupancy measurements add checkpoints. Set the
star's point 0 to **Unpinned**. Keep the tab visible; Stop retains partial evidence.
Export JSON locally. Keep shared findings and reproduction instructions in Markdown.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/production-settings.test.ts src/experiments/combined-layout/production-routing.test.ts src/experiments/combined-layout/checkpoint-replay.test.ts src/experiments/combined-layout/varied-spring.test.ts
```

**Next:** compare matched production WebGL, WebGPU and CPU inputs and measure
layout quality separately from numerical parity. Center attraction follows that
comparison. Broader weights/graphs, remaining forces, full renderer/API behavior,
allocation policy and other native GPUs remain migration gates.
