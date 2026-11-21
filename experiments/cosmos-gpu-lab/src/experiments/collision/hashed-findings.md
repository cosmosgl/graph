---
source: Recorded findings
recorded: 2026-11-19
device: Apple M3; native Chrome 157; ANGLE Metal WebGL and non-fallback Apple Metal 3 WebGPU
scope: Isolated comparisons at 4,097 and 8,192 points, plus normal-tick validation and timing at 8,192.
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

## Direct WebGL comparison

The production WebGL depth-peeling shaders selected the same point IDs as
WebGPU across all 18,874,368 slot entries, including the tied hash, the
full bucket and the signed cell alias. Both backends passed the existing
force and position gate on shared inputs and independently evolving layouts.

| Points | Passes | Slot differences | Max same-input force difference | Max same-input position difference | Max trajectory difference |
| --- | --- | --- | --- | --- | --- |
| 4,097 | 4 / 4 | 0 | 2.38e−7 | 0 | 0 |
| 8,192 | 5 / 5 | 0 | 1.19e−6 | 1.53e−5 | 4.58e−5 |

All differences are absolute world units. The pin, absence, cap and cooling
checks passed in both backends. The WebGL control used the production GLSL,
RG32F slot targets, depth24plus peeling, layer copies and position integrator
through luma `10.0.0-alpha.15` in native visible Chrome 157. WebGL reported an
Apple M3 ANGLE Metal renderer. WebGPU reported non-fallback Apple Metal 3.
The focused test passed 3/3.

The capture is in `captures/collision-hashed-webgl-m3-20261119.8TyBK8/`.
The accompanying `source.tar.gz` includes the tested worktree and lockfile,
with SHA-256 `51b39175cc72b60ca6c9fda076c17194c859b12262fca1159af8b0553efbfccb`.

## Normal tick at 8,192 points

```result-chart
{
  "title": "Two collision passes increased GPU time per tick",
  "context": "Median GPU time for simulation and drawing · 8,192 points · Apple M3",
  "unit": "ms",
  "bars": [["Collision off",7.63],["Collision on",9.71]]
}
```

Two hashed collision passes added **2.03 ms per tick** on the M3. The paired
GPU measurement includes compute and drawing. The median was 7.63 ms with the
collision passes omitted and 9.71 ms with them enabled. Both lanes used spring
rest lengths that respect contact radii and drew the resulting graph with the
same camera and settings. There were 28 measured frames per lane.

Three moving ticks matched the independent CPU positions exactly. The dense
two-pass check, the exact path after shrinking to 4,096, and the hashed path
after regrowth and a radius update also matched the CPU. Zero strength skipped
the passes and used the same tracked buffer allocation as a graph without
collision configured.

The visible Chrome 157 run passed 2/2 on non-fallback Apple Metal 3. The capture
and exact tested source archive are in
`captures/collision-hashed-tick-m3-20261119.zgXgWH/`, with source SHA-256
`f75165c9d277db19c33130eef30427c166d36ba58c1b5b75255e286b50bbfd29`.
Performance on larger graphs and sustained dense layouts remains open.
[Declared fixtures and gates](#/collision/docs/hashed-method)
