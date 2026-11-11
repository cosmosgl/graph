This page records the **exact-size rebuild baseline**. Select **CPU copy vs GPU rebuild** in the demo to
reproduce it. The [retained-capacity follow-up](#/point-capacity/docs/reuse) compares two GPU-bound lanes and
reuses storage and kernels within a high-water allocation.

Point-count changes affect more than the position buffer. Cosmos must also update random samples, hierarchy
dimensions, force scratch space, integration limits, sizes, adjacency and rendering counts. This experiment
checks those dependencies while **retaining the same luma device** for each lane.

## Two update contracts

**Resize + preserve** is an internal storage operation. It copies the surviving prefix of the current GPU
positions, including pinned and absent flags, into both new ping-pong buffers. Newly added indices receive
fresh fixture positions. Shrinking truncates the GPU tail; growing again initializes coordinates and presence
rather than reviving old GPU records. Cosmos's separate **CPU pinned-index set** persists, including indices
temporarily outside the logical count, so regrowth reapplies those registered pins to the new coordinates.
Tick and alpha belong to the session and are not reset by allocation.

**Replace all positions** is authoritative for coordinates and presence, with no old-position copy. The CPU
pinned-index set remains in effect. It demonstrates immediate replacement separately from storage preservation. Production
`Graph.setPointPositions(...); render(undefined, 0)` similarly takes explicit supplied positions without an
animated transition; this experiment does not port that public API, coordinate rescaling or visual channels.

Production Cosmos treats a NaN coordinate as absence and keeps the index gap. Its default position transitions
can pause simulation; those animation and pause/resume rules remain separate. Here **Hide point 1** changes only
the absent flag in a small compute dispatch, preserving its current coordinates and pin flag. **Restore point 1**
reactivates that held location. Hidden points neither render nor contribute to the force layout. Hiding is not
array compaction, and does not change the logical count used to select hierarchy dimensions.

## Resize dataflow

```flow
Old resident state · Keep the old generation alive during preparation
Allocate replacement · Same device; new count-dependent buffers and kernels
Transfer · GPU prefix copy plus tail upload | Reference transfer · CPU prefix download and complete position upload
Ready · Wait for initialization/copies, then switch generations
Release · Destroy old generation resources; keep the owner device
Validate · Compare all position bits; then run the next evolved frame and CPU check
```

All GPU access uses public luma APIs: `Buffer`, `Kernel`, passes, `CommandEncoder.copyBufferToBuffer`, fences
and query sets. A backend generation borrows its lane's device and destroys only its own resources. The lane
destroys the device when the session ends. The device-loss listener is shared across generations.

The selected luma buffer size is fixed, so [GPU buffer growth](https://luma.gl/docs/api-reference/core/resources/buffer)
requires replacement storage and a copy. The surviving `vec4` records are copied **twice**, once into each new
position buffer. Only the appended tail is uploaded on the resident path. For an old count `a` and new count `b`:

| Transfer | GPU-preserving lane | CPU-copy reference |
| --- | --- | --- |
| Surviving records | `min(a, b)` | `min(a, b)` |
| Position download bytes | **0** | `16 × min(a, b)` |
| GPU position copy bytes | `32 × min(a, b)` | 0 |
| Position upload bytes | `32 × max(b − a, 0)` | `32 × b` |

Samples, sizes, adjacency and other resources also need initialization; those uploads are additional.
The table isolates the position-transfer contract. Validation downloads occur **outside** the measured update.
They are not a hidden fallback inside the resident resize implementation.

This first implementation uses **exact-size generations**. It rebuilds count-dependent resources and kernels
on every logical-count change. It does not yet retain a larger capacity on shrink, reuse pipelines aggressively
or implement a pooled allocator. Its measurements include that conservative rebuild strategy.

## What is checked?

- Every surviving position record and new tail record matches its expected bits after resizing.
- Both lanes retain their device; previous position buffers are explicitly destroyed.
- Pinning, held absent coordinates, tick and alpha survive preserving resizes.
- Regrowth initializes discarded coordinates/presence while reapplying registered pins; explicit full replacement
  uses supplied coordinates/presence rather than old GPU positions.
- The next simulation-plus-drawing frame matches the staged reference bit for bit and, when enabled, the
  unchanged independent CPU whole-tick tolerance.
- Repeating the same count returns to the same tracked footprint; session destruction returns its tracked
  application-buffer counters to zero. Native tests also check luma's reported buffer bytes at repeated counts.
- Invalid counts are rejected before replacing the current generation.

The force path stays hierarchical at all tested counts, including counts at which production normally uses
all-pairs. This isolates the storage contract; it does not validate the production exact-to-grid switch.

## Read the costs correctly

**Completion ms** begins after preparing and validating the supplied fixture arrays. It includes CSR building,
shader/pipeline setup, allocation, uploads,
the position copy and the initialization/completion wait. The CPU reference additionally downloads the prefix.
`setupMs` and CPU copy-submission time are available in the JSON export; neither is pure GPU copy duration.
Synthetic input generation and the surrounding validation snapshots are outside this interval.
New buffers coexist with the old ones until readiness is established, so peak allocation matters.

**Live / peak MiB** in the table counts explicitly owned application buffers. The peak is captured while old
and new generations coexist. It excludes driver memory, compiled pipelines, textures and library-owned internal
staging/uniform buffers; it is not total VRAM usage. JSON also records sampled **luma-reported Buffer Memory**
before preparation, before retiring the old generation and after retirement. Those luma counters aggregate all
devices in the page, so they are useful cleanup cross-checks, not per-lane memory measurements.

**First-frame GPU work** sums begin/end timestamp pairs within the compute and render passes, following the
[resident timing method](#/resident-layout/docs/timing-updates). CPU validation is outside the interval. These
are evolving frames immediately after updates, including first-use effects; do not treat them as steady-state
FPS or directly compare their medians with the fixed-initial-state frame benchmark.

## Reproduce

Open [Point capacity and memory](#/point-capacity), select **CPU copy vs GPU rebuild**, choose a graph, leave **Check unchanged CPU tolerance** on,
and run **Run resize cycles**. The cycle returns to 2,048 points so retained memory can be checked again:

```flow row
2,048 · Initial
8,192 · Grow
4,096 · Shrink
8,192 · Reinitialize removed tail
2,048 · Return to the starting count
```

Use point 0 pinning and point 1 absence before a cycle to exercise their preservation. Individual resize and
replacement controls support direct inspection. **Stop** retains completed rows; **Export JSON** saves local
results, edit history, transfer counts and memory accounting. Routine exports stay outside Git.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/capacity.test.ts
```

The native tests include three small repeated cycles, dropped-tail initialization, authoritative replacement,
invalid requests, cleanup after a deliberately rejected kernel setup, and the
2,048 → 8,192 → 4,096 → 8,192 → 2,048 path under the existing CPU tolerance.
The current experimental count limit is 16,384; the initial acceptance cycle only reaches 8,192.

## Findings

Validated **11 November 2026**, **Apple M3**, standalone **Chrome 156**, pinned **luma 10.0.0-alpha.4**.
Chain, communities and star each ran three cycles with point 0 pinned, point 1 absent, and CPU checks enabled.
All **36 paired resize checks and 36 subsequent whole-tick CPU checks pass** with unchanged tolerance. Every
lane keeps the same device; tick and cooling continue. Native regressions separately cover dropped-tail
initialization, pinned indices outside the current range, full replacement, rejected requests and cleanup.

### Memory returns to the same count-dependent footprint

Explicit resident-lane application buffers, MiB:

| Graph | 2,048 points | 4,096 points | 8,192 points | Largest old + new peak |
| --- | --- | --- | --- | --- |
| Chain | 3.640 | 5.531 | 14.656 | **20.188** |
| Communities | 3.709 | 5.668 | 14.930 | **20.598** |
| Star | 3.640 | 5.531 | 14.656 | **20.188** |

Each repeated count had identical tracked bytes and luma-reported page-wide buffer bytes. Resetting the
chain and community sessions returned both lanes' tracked counters to **zero**. The native tests also
destroy sessions and verify that every tracked application buffer is released. These are buffer-accounting
observations, not proof of zero driver memory or freedom from every possible leak.

The largest peak occurs on **8,192 → 4,096** and **4,096 → 8,192**: the old and new generation coexist.
A shrink can therefore require extra temporary memory. Communities use more adjacency storage; star's
high degree changes work distribution but not its edge count relative to chain.

### Removing readback does not make this rebuild strategy cheaper

Across the three repetitions, resize completion medians in ms, **CPU-copy reference / GPU-copy lane**:

| Transition | Chain | Communities | Star |
| --- | --- | --- | --- |
| 2,048 → 8,192 | 14.9 / 23.4 | 15.5 / 23.1 | 17.1 / 19.0 |
| 8,192 → 4,096 | 15.5 / 18.3 | 16.6 / 20.3 | 14.7 / 19.5 |
| 4,096 → 8,192 | 14.7 / 18.4 | 15.6 / 19.5 | 15.0 / 18.5 |
| 8,192 → 2,048 | 13.3 / 19.2 | 14.9 / 18.6 | 14.7 / 18.0 |

The resident lane downloads **zero** position bytes. Growing 2,048 → 8,192 copies 64 KiB within the GPU and
uploads 192 KiB of position tails, versus the reference's 32 KiB download and 256 KiB upload. Shrinking
8,192 → 4,096 copies 128 KiB and uploads no positions. Other resource initialization remains substantial.

Despite those transfer savings, the resident lane is slower in these update observations. This is a comparison
of two complete generation setups, including different bounds resources and their setup/waits, not an isolated
GPU-copy versus readback benchmark. CPU reference always updates first; order/cache effects are another limit.
The evidence supports correctness and transfer semantics, **not a resize speedup**. Retained-capacity buffers
and kernel reuse are the next optimization to compare with this conservative baseline.

### First frames are a separate cost

GPU compute + drawing work immediately after updates at 8,192 points, median and observed range:

| Graph | Median | Range |
| --- | --- | --- |
| Chain | 13.730 ms | 11.141–17.433 ms |
| Communities | 15.466 ms | 8.651–17.695 ms |
| Star | 21.201 ms | 16.450–30.343 ms |

There are six observations per graph at this count. Each starts from an evolving layout after a resize;
new tail nodes, cooling, allocation/first-use behavior and input geometry all vary. These broad ranges cannot
be substituted for the separate fixed-initial-state frame benchmark or attributed entirely to GPU copying.

The next migration questions are retained-capacity/pipeline reuse, failure recovery, resource ownership with a
host device and the remaining Cosmos visual/update API. Animated transitions and default-length simulation
remain outside this immediate-update experiment.
