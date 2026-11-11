Growing storage and shrinking a graph are different operations. **Logical count** says how many point records
belong to the graph. **Capacity** says how many records its allocation can hold. Keeping those separate lets
Cosmos change the count without rebuilding its entire GPU workload each time.

The [rebuild baseline](#/point-capacity/docs/findings) established preservation and cleanup, but recreated
count-dependent resources on every update. This follow-up compares **GPU rebuild** with **GPU retained
capacity**. Both use GPU bounds, the same force sequence, refined arithmetic and minimal renderer.

## What stays and what changes?

The retained lane starts at 2,048 capacity. Its first growth to 8,192 creates a replacement generation on the
same device, copying surviving records and uploading the new tail. Later counts that fit that allocation reuse
its position/scratch buffers, topology buffers, compute kernels and render kernels. Capacity follows the largest
requested count; there is no advance reservation, geometric growth factor or automatic trim.

```flow
Validate the new input · Keep tick, cooling, device and registered pins
Count exceeds capacity · Prepare a larger generation, GPU-copy prefix, upload tail, then retire old resources | Count fits capacity · Keep buffers and kernels; update logical sizes and upload changed input
Reconfigure dependent work · Samples, CSR adjacency, grid levels, bounds reduction, uniforms and draw counts
Validate positions · Surviving prefix and fresh tail must match the expected bits
Run the next frame · Compare against rebuild and the unchanged independent CPU tolerance
```

| Resource or operation | Inside retained capacity |
| --- | --- |
| Current point records | Remain in the current GPU buffer; **no prefix copy or download** |
| Newly added records | Uploaded into both ping-pong buffers |
| Removed records | Outside the logical graph; old bytes remain allocated and unused |
| Regrown tail | Receives fresh coordinates/presence; registered CPU pins are reapplied |
| Samples and topology | CPU samples/CSR are uploaded into existing buffers |
| Grid scratch and centroids | Reused, with active grid dimensions and strides recomputed from logical count |
| Bounds reduction | Uses the logical number of records and active reduction levels |
| Simulation dispatches and drawing | Use logical count, not buffer capacity |
| Kernels and pipelines | Kept by the generation; dispatches supply current bindings and dimensions |

A buffer's allocation size is fixed by WebGPU, so retaining spare bytes avoids replacing it when later counts
fit. The algorithm must carry an explicit logical count: a storage array's physical length can include inactive
records. Simply leaving old points in a larger array would alter bounds, forces or drawing if any stage processed
the whole allocation. [WebGPU buffer contract](https://gpuweb.github.io/gpuweb/#gpubuffer)

The generation's kernels also survive these updates. luma's kernel abstraction owns compiled GPU programs and
accepts bindings per dispatch/draw. The live reference uses a newer package layout; this lab stays pinned to
**10.0.0-alpha.4**, with its working imports from `@luma.gl/engine`.
[luma Kernel reference](https://luma.gl/docs/api-reference/graph/kernel)

## Preservation and failure boundaries

Surviving indices keep their current coordinates, presence and pin state. Shrink/regrowth does not resurrect
discarded coordinates or absence. The separate CPU pin set survives, including temporarily out-of-range
indices. Full replacement remains authoritative for coordinates/presence and retains registered pins.
Tick and alpha continue in either case.

Preserving an in-capacity prefix does not require making both ping-pong buffers identical. Each integration pass
reads the current buffer and writes every logical output record, including held pinned/absent records. New tails
and explicit replacements are written to both buffers; the current prefix remains the source of truth.

CPU validation and topology-capacity checks precede in-place writes. Native checks reject oversized adjacency
without changing the old positions or logical count. A larger generation is prepared before switching, retaining
the previous rollback/cleanup behavior if setup fails. An unexpected GPU failure during an in-place update does
**not** provide transactional rollback; reset/recovery is still required. Host-owned devices and device recovery
remain separate migration gates.

## Measurement method

The repeatable cycle remains **2,048 → 8,192 → 4,096 → 8,192 → 2,048**. Both lanes use GPU bounds, so this
comparison removes the CPU-bounds versus GPU-bounds difference in the earlier transfer control. Measured
resize completion includes input validation inside the backend, CSR construction/packing, writes, any generation
setup/copy and the completion fence. Synthetic fixture generation and validation snapshots are outside it.

**First growth is separate from reuse.** It creates new storage in both lanes. Subsequent in-capacity updates
are the optimization being tested; their transfer table records zero GPU prefix-copy bytes. Position-upload bytes
still count both ping-pong tails and exclude the separate samples/topology uploads.

Both lanes also receive compute-plus-render timestamp measurements for the next evolved frame. Adjacent
begin/end pairs stay within each pass, and compute/render durations are summed. Queries, CPU oracle work and
snapshot downloads are outside the measured GPU work.

Order matters in this small sample. Initial exploratory runs often measured a slower first lane. Alternating
by tick was insufficient: the cycle reaches 8,192 only at odd ticks. The recorded comparison now alternates
**per point count** for frames and **per transition** for resizes. At 8,192, each lane runs first three times.
JSON records both orders. This controls one bias; it does not eliminate scheduling, thermal, first-use or
allocation/cache effects, and does not identify which mechanism caused the initial order sensitivity.

Memory counts explicitly owned application buffers, including scratch and adjacency. luma-reported buffer
bytes are a page-wide cleanup cross-check. Neither is total VRAM: driver allocations, pipelines, textures and
library-owned internal buffers are excluded from the explicit ledger.

## Native M3 findings

Validated **11 November 2026**, standalone **Chrome 156**, **Apple M3**, luma **10.0.0-alpha.4**. Chain,
communities and star each ran three cycles with point 0 pinned, point 1 absent and CPU checks enabled.

All **36 paired resize checks and 36 subsequent whole-tick checks pass**, with **zero position/force bit
differences** between GPU lanes and the original independent CPU tolerance unchanged. After first growth,
33 updates reuse the candidate generation. Additional native tests exercise changes across grid dimensions
and bounds-reduction depth, no new buffer/kernel creation, discarded tails, full replacement, rejected topology
and cleanup. Repeated sizes return to stable tracked and reported buffer bytes; resetting sessions releases
both lanes' tracked application buffers to zero.

### Reuse reduces update latency in these runs

Completion medians in ms, **GPU rebuild / GPU retained**, excluding the first allocation growth:

| Transition | Observations per graph | Chain | Communities | Star |
| --- | --- | --- | --- | --- |
| 2,048 → 8,192, already allocated | 2 | 19.40 / **2.35** | 20.05 / **2.45** | 19.60 / **1.45** |
| 8,192 → 4,096 | 3 | 21.30 / **1.00** | 20.60 / **1.50** | 20.90 / **1.00** |
| 4,096 → 8,192 | 3 | 21.70 / **1.70** | 20.50 / **2.70** | 20.70 / **1.70** |
| 8,192 → 2,048 | 3 | 19.30 / **0.60** | 19.00 / **0.70** | 20.40 / **0.60** |

These are small, local update samples, not expected timings for another machine. The first growth still builds
both generations: rebuild/retained completion was 50.8/35.1 ms for chain, 30.0/22.1 for communities and
36.4/22.8 for star. That single, ordered setup observation cannot establish a growth speedup; no reuse happened
yet. Growth beyond the high-water count will pay generation setup and a GPU prefix copy again.

### The memory tradeoff is substantial

Explicit application buffers, MiB:

| Graph | Rebuild after returning to 2,048 | Retained after returning to 2,048 | Rebuild cycle peak | Retained cycle peak |
| --- | --- | --- | --- | --- |
| Chain | 3.640 | **14.656** | 20.188 | **18.297** |
| Communities | 3.709 | **14.930** | 20.598 | **18.639** |
| Star | 3.640 | **14.656** | 20.188 | **18.297** |

In-capacity updates have no old-plus-new allocation spike. The candidate's cycle peak is its first
2,048-plus-8,192 growth. Its retained footprint then stays at the 8,192 allocation, even after a large shrink.
This saves later setup/temporary allocations by keeping substantially more idle storage. Production needs a
memory budget and explicit trimming or shrink hysteresis; retaining the largest graph indefinitely is not an
approved policy.

### Update gains do not establish faster simulation frames

At 8,192 points, six first-frame observations per graph, with lane order balanced:

| Graph | Rebuild GPU median | Retained GPU median | Rebuild range | Retained range |
| --- | --- | --- | --- | --- |
| Chain | 12.943 ms | 11.239 ms | 7.012–17.957 ms | 7.143–19.202 ms |
| Communities | 11.239 ms | 15.565 ms | 6.881–18.416 ms | 10.748–18.481 ms |
| Star | 20.808 ms | 18.547 ms | 12.583–30.736 ms | 12.911–28.377 ms |

The ranges overlap and the layout evolves between rows. This is not a steady-state FPS comparison. A separate
star follow-up grew to 8,192 after the three cycles, ran two warm-up frames and then eight checked frames with
balanced order. All ten checks passed. On the final implementation, the eight-frame GPU medians were
**27.197 ms rebuild versus 15.139 ms retained**, with ranges **18.874–30.736 ms** and **11.993–36.372 ms**.
The lower candidate median is an observation of this evolved star workload, not a general simulation speedup.
Both variants keep the baseline's buffer initialization and usage flags; frame measurements still span broad,
overlapping ranges and remain sensitive to execution order.

The next investigation should profile the composed GPU stages under controlled, repeated inputs and check
ordering effects before adopting a retention policy or trying larger stars. The diagnostic hierarchy still has
atomic linked-list construction, per-cell ordering and a crowded-cell fallback. These can vary in cost even
when deterministic accumulation produces identical answers; their contribution to these timing differences
has not been isolated. No force arithmetic or tolerance changed in this experiment.

## Reproduce

1. Open [Point capacity and memory](#/point-capacity). Choose **GPU rebuild vs retained capacity**.
2. Select chain, communities or star; keep **3 repetitions** and **Check unchanged CPU tolerance** enabled.
3. Use **Move + pin point 0** and **Hide point 1**, then **Run resize cycles**.
4. Inspect the capacity, reuse, transfer and memory columns; both devices and tick/cooling should persist.
5. **Export JSON** for local analysis. Reset or change graphs to verify cleanup; routine exports stay outside Git.

For the warm-star follow-up, after the three cycles select 8,192 and **Resize + preserve**. Use **Step + validate**
ten times. Discard the first two of those ten timings and inspect the last eight, retaining their order metadata.
These remain evolved-layout observations, not a fixed-input benchmark.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/capacity-reuse.test.ts
```

The previous **CPU copy vs GPU rebuild** mode remains available. It tests a different transfer contract and
should be interpreted with the limits in its [baseline findings](#/point-capacity/docs/findings).
