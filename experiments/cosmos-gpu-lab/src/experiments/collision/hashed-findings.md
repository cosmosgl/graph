---
source: Recorded findings
recorded: 2026-11-19
device: Apple M3; native Chrome 157; non-fallback Apple Metal 3 WebGPU
scope: Isolated hashed collision at 4,097 and 8,192 points, compared with an independent CPU slot model.
---

# Hashed collision passes at 4,097 and 8,192 points

**The WebGPU collision stage matched the CPU slot model in all nine passes.**
It selected the same slot IDs and moved points to the same coordinates at
both counts. The largest force difference was `1.19e-7` world units.

| Points | Passes | Slot differences | Max force difference | Max position difference | Peak bucket occupancy |
| --- | --- | --- | --- | --- | --- |
| 4,097 | 4 / 4 | 0 | 1.19e-7 | 0 | 2 |
| 8,192 | 5 / 5 | 0 | 1.19e-7 | 0 | 70 |

The signed wrap-boundary case applied the expected single correction to a
touching pair whose two world cells shared a bucket. The 8,192-point case
selected 32 slots from a bucket of 70 occupants, exercised one tied hash and
rebuilt the buckets after every pass. At zero alpha with cooling, no points
moved. Pins, absence sentinels and correction caps passed at every step.
The collision stage owned 8,683,592 bytes at 4,097 points and 8,716,352 bytes
at 8,192, excluding shared position and force buffers and driver memory.

Recorded on 19 November 2026 on Apple M3, macOS 26.5.2, and visible native
Chrome `157.0.8103.79` with luma `10.0.0-alpha.15`. The adapter reported
Apple Metal 3 with `fallback: false`. The focused test passed 3/3. Local
captures `collision-hashed-4097.json` and `collision-hashed-8192.json` are in
`captures/collision-hashed-m3-20261119-wZO2Zc/` alongside `source.tar.gz`
and `source-context.json`. The source archive includes the working tree and
lockfile, with SHA-256 `69263becdf0320774f945c8ff7883dd8d9c6a13911acbc7b5279f38263d6d7b5`.

Production readiness remains open. The CPU defines which point wins a hash
tie, and the unchanged WebGL depth-peeling path still needs a direct
comparison on the same inputs. Dense-bucket time, counts above 8,192, and
whole-layout behavior with links and other forces remain unmeasured. The
study used the [declared fixtures and gates](#/collision/docs/hashed-method).
