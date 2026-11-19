---
source: Recorded measurement
recorded: 2026-11-18
device: Apple M3; visible Chrome 157; luma.gl 10.0.0-alpha.15
scope: Frozen center and force work on one deterministic, offset point distribution
---

# Center-force measurement evidence

The measurement compares the existing center force with an opt-in linear
candidate on the same GPU-resident input. A CPU double-precision sum supplies
the center reference. The linear candidate's force components are compared with
the existing force using the unchanged absolute 2e-5 and relative 3e-5 gate.

On 18 November 2026, two warmups and seven samples produced these median GPU
times on the recorded M3 session. The reduction and force columns describe
separate work; they are not complete-frame timings.

| Points | Center reduction | Existing force | Linear candidate | Candidate force check |
| ---: | ---: | ---: | ---: | --- |
| 8,192 | 0.174 ms | 4.802 ms | 0.012 ms | All pass |
| 1,000,000 | 1.391 ms | 179.619 ms | 0.624 ms | All pass |
| 4,194,240 | 4.911 ms | 694.507 ms | 1.777 ms | All pass |

All points were present and one in 101 was pinned. The candidate was checked
against every existing force component; only the first 64 forces were also
checked against the scalar reference. Counts and high/low aggregate bits matched
the reference in these rows.

For this offset distribution, the WebGL blend control's center error reached
4.30 world units at one million points and 24.64 at four million. These are
diagnostic observations for this input, not general error bounds.

A separate paired measurement compared dividing by the count for each point
with calculating the center once on the GPU. At one million points, the medians
were 2.431 and 2.447 ms respectively. The paired difference ranged from −0.201
to +0.105 ms, so the run did not establish a speedup.

These results cover one machine and one distribution. The WebGL control's
elapsed time includes readback and cannot be compared directly with the WebGPU
timestamps. Isolated force cost does not establish full-frame responsiveness,
visual quality or equivalence of independently evolving trajectories. Raw
measurements and the source snapshot remain in the experiment's local research
records.
