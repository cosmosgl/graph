---
source: Recorded findings
recorded: 2026-11-09
device: Apple M3, Chromium 157, ANGLE Metal WebGL and Apple WebGPU
scope: Exact all-pairs repulsion, shared-input checks and bounded independent trajectories
---

# Exact repulsion evidence

Same-input force and position checks passed for both direct and tiled WebGPU
alongside the production WebGL and CPU paths on the recorded fixtures.

| Input | Recorded observation |
| --- | --- |
| 128 uniform points | Ten ticks; tick-10 WebGPU/CPU maximum force error `1.79e−7` and position error `3.81e−6` |
| 65 clustered points | Ten ticks with every force and position component checked |
| 65 coincident points | Ten shared-input ticks passed at the original tolerance |
| 8 boundary or absent/pinned points | Ten ticks, including absent-state preservation |

An independently evolving coincident input exceeded the one-step budget by
tick two, including on WebGL. Checking each step against the CPU calculation
for that backend's actual prior positions passed without changing the budget.
This distinguishes local agreement from trajectory drift; it does not establish
long-term layout quality, cross-device behavior or full-graph performance.
