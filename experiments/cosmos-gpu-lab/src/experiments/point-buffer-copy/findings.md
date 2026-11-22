---
source: Recorded findings
recorded: 2026-11-11
device: Apple M3; standalone Chrome 156
scope: Exact-size rebuild baseline with retained IDs, data preservation and tracked buffer cleanup.
---

In the recorded chain growth from **2,048 to 8,192 points**, the CPU path downloaded **32 KiB**:
2,048 existing position records at 16 bytes each. The GPU path downloaded **0 KiB**. It copied those records
directly into both new position buffers (64 KiB copied on the GPU) and uploaded 192 KiB for the added points.
The CPU path uploaded 256 KiB for the expanded positions.

The live demo repeats that single growth. Each press starts with the same 2,048-point chain.
Both previews rebuild their buffers. [Adding and removing points](#/point-capacity?section=doc-method) explores what happens when buffers can be reused.

## Recorded checks

On 11 November 2026, chain, communities and star graphs each ran three grow, shrink and regrow cycles on an Apple M3
in standalone Chrome 156 with luma 10.0.0-alpha.4. Point 0 was pinned and point 1 was absent.
All 36 paired resizes preserved the expected point records, and all 36 following simulation steps passed the CPU check.
Those validation downloads ran outside the measured update.

## Recorded rebuild times

For the first growth of the chain, median total rebuild time was **14.9 ms** through the CPU and **23.4 ms** on the GPU.
The timer covered resource setup, position transfer and the wait for GPU completion. The two paths used different
bounds setup, and the CPU path always ran first. These measurements cannot isolate the speed of the copy itself.

Median milliseconds across three repetitions, **CPU copy / GPU copy**:

| Transition | Chain | Communities | Star |
| --- | --- | --- | --- |
| 2,048 → 8,192 | 14.9 / 23.4 | 15.5 / 23.1 | 17.1 / 19.0 |
| 8,192 → 4,096 | 15.5 / 18.3 | 16.6 / 20.3 | 14.7 / 19.5 |
| 4,096 → 8,192 | 14.7 / 18.4 | 15.6 / 19.5 | 15.0 / 18.5 |
| 8,192 → 2,048 | 13.3 / 19.2 | 14.9 / 18.6 | 14.7 / 18.0 |

## Buffer memory and first frames

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

GPU time for the first simulation and drawing frame after an update to 8,192 points, in milliseconds:

| Graph | Median | Range |
| --- | --- | --- |
| Chain | 13.730 ms | 11.141–17.433 ms |
| Communities | 15.466 ms | 8.651–17.695 ms |
| Star | 21.201 ms | 16.450–30.343 ms |

Each graph contributed six frames from evolving layouts. For a comparison starting from a fixed layout, see
[Timing a GPU layout frame](#/resident-frame-timing?section=doc-method).
