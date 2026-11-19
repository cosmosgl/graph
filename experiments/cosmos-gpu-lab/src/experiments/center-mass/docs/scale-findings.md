---
source: Local investigation
recorded: 2026-11-18
device: User's Apple M3 Mac; visible Chrome 157; WebGPU reports Apple metal-3, non-fallback
scope: One offset/asymmetric point distribution up to 4,194,240; bounded combined-graph tests; not production approval
---

# M3 center-force scale findings

The recursive center reduction reached **4,194,240 points** on this machine.
The current force shader, rather than the reduction, dominated the isolated
cost. A simpler, opt-in linear force was much faster and passed the existing
force tolerance on every point in these frozen inputs. It is promising, but the
8,192-point independently evolving graph **failed the existing strict position
comparison**, so it is not a production replacement yet.

## Scale and force

Visible Chrome 157, luma.gl `10.0.0-alpha.15`, WebGPU core, timestamp queries,
two warmups and seven samples. These are **median isolated GPU times**, not
frame times. Each row uses one deterministic, offset, asymmetric point
distribution; all points are present and 1 in 101 is pinned. The CPU reference
sums the uploaded float32 coordinates in JavaScript double precision.

| Points | High/low reduction | Existing force | Linear candidate | Candidate vs current force |
| ---: | ---: | ---: | ---: | --- |
| 8,192 | 0.174 ms | 4.802 ms | 0.012 ms | All pass |
| 65,536 | 0.110 ms | 8.206 ms | 0.023 ms | All pass |
| 100,000 | 0.202 ms | 14.264 ms | 0.022 ms | All pass |
| 1,000,000 | 1.391 ms | 179.619 ms | 0.624 ms | All pass |
| 2,000,000 | 2.515 ms | 334.611 ms | 1.023 ms | All pass |
| 4,000,000 | 4.827 ms | 638.111 ms | 1.780 ms | All pass |
| 4,194,240 | 4.911 ms | 694.507 ms | 1.777 ms | All pass |

The final column compares **every force component** with the current shader
using the unchanged absolute 2e-5 / relative 3e-5 tolerance. It is not an
independent full-array mathematical reference: the first 64 forces were also
checked against the scalar reference. The high/low aggregate matched the
float32-rounded CPU sum bit for bit and had exact counts in all these rows.
At one million, its center was about 0.000069 world units from the CPU double
sum. The simpler float32 reduction passed the same bit check on some sizes and
failed on others; its individual results are retained in the raw capture.

The WebGL blend control counted correctly, but on this particular offset
distribution its center error grew to 4.30 world units at one million and 24.64
at four million. That is a diagnostic observation for this input, not a
universal error bound or a speed comparison. WebGL's reported elapsed time
includes synchronous readback; the table's WebGPU timestamps do not.

The adapter exposed a 65,535 workgroup limit and a 128 MiB maximum storage
binding. The current one-dimensional, 64-thread force dispatch therefore caps
this implementation at **4,194,240 points**. That boundary completed, and the
test rejected one point more before allocation. This is not a measured physical limit of the M3, and
larger counts would require a different dispatch/buffer strategy.

## Combined graph and visual check

The opt-in candidate and current force ran independent 200-tick community
layouts at 512 and 8,192 points, each with one pinned and one absent point.
Positions remained finite; pin, absence and flag checks passed at each recorded
checkpoint. At 512 points the existing strict position comparison passed at
all checkpoints. At 8,192 points it failed beginning at tick 10; at tick 200,
1,103 coordinate components exceeded its tolerance.

At tick 200 on the 8,192-point graph, RMS position difference was 0.0975 world
units and the largest difference was 2.404 world units. With the shared
480 × 340 view, the corresponding RMS displacement was 0.038 pixels and the
largest was 0.941 pixels. The two final still images looked very similar on
inspection. This is one view and two fixtures, not a continuous-motion review
or proof that every graph will look the same.

For a separate frozen 8,192-point chain, the complete prototype simulation and
draw passed its existing WebGPU numerical gate. Seven paired samples reported
median center-off/on GPU times of 9.69/11.71 ms with the current force and
9.51/9.64 ms with the linear candidate; paired median center costs were 2.18
and 0.24 ms respectively. These are GPU frame-work timestamps from separate
runs, not end-to-end frame intervals. The WebGL control failed its strict
preflight, so its frame summary was not accepted.

The same candidate's frozen 16,384-point chain completed its WebGPU strict
preflight and frame samples. Median center-off/on GPU times were 14.56/13.96 ms;
the paired differences ranged from -0.73 to 0.17 ms, so they do not resolve a
positive center cost. The prototype rejected 16,385 points at its input guard.
Separately, its streamed repulsion allocates 800 bytes per point for one
buffer: at one million that is 800 MB, exceeding the recorded 128 MiB
storage-binding limit. This is an identified architectural obstacle, not a
measured maximum graph size. **A million-point combined graph has not run.**

A follow-up [center-once investigation](#/center-mass?section=doc-once-findings-computing-the-center-once)
keeps the mean on the GPU and removes per-point division. Its tested results
matched the linear control, but its timings did not show a clear improvement.

## Source and reproduction

Raw measurements and the exact source/dependency snapshots are retained locally:

- `captures/center-linear-m3-20261118/center-scale.json` and its
  `source-snapshot.tar.gz`.
- `captures/center-integrated-refined-20261118/center-frame.json` and
  `captures/center-integrated-linear-20261118/center-frame.json`.
- `captures/center-integrated-trajectory-20261118/center-trajectory.json` and
  `trajectory-8192.png`. The integrated captures use
  `captures/center-integrated-m3-20261118/source-snapshot.tar.gz`.
- `captures/center-boundary-m3-20261118/center-scale.json` and
  `captures/center-boundary-frame-20261118/center-frame.json` use the source
  snapshot in `captures/center-boundary-m3-20261118/`.

The WebGPU adapter exposed Apple/metal-3 and `fallback: false`, but not the
chip model; the same session's WebGL renderer identified Apple M3. See
[M3 scale study](#/center-mass?section=doc-scale-method-m3-center-force-scale-study)
for the protocol, the unchanged strict gates, and the opt-in commands. More
distributions, sustained moving interaction, integrated larger graphs, memory
behavior and practical visual quality remain to be checked.
