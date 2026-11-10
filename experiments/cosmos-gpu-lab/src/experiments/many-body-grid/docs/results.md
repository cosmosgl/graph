## What this establishes

The hierarchical force can be expressed through luma WebGPU without floating-point atomics. With deterministic cell
summation, the checked WebGPU outputs match production WebGL within the existing budget, including the dense fixture.
That is **partial port evidence**, not a fully validated production replacement: the default inline dense fixture still fails the
strict CPU-reference comparison, and bounds reduction, adaptive sampling, scaling and convergence remain open.

### Native Apple M3 observations

Measured in the in-app Chromium 157 browser on Apple M3. WebGL uses ANGLE Metal; WebGPU reports the Apple adapter.
These are same-input correctness checks, not performance measurements. Each run starts from the deterministic fixture;
all samples below use the stable source-order builder.

| Fixture | Points | Slots / quality | Completed checks | Outcome |
| --- | ---: | --- | --- | --- |
| Uniform | 8,192 | 8 / precise | Three ticks | Full CPU and GPU cross-checks pass |
| Uniform | 16,384 | 8 / precise | One tick | Full CPU and GPU cross-checks pass |
| Dense clusters | 8,192 | 8 / precise | One tick | Structures, selected IDs, GPU cross-check and isolated integration pass; full CPU output check fails |
| Absent / pinned edge cases | 8 | 32 / balanced | Three ticks | Full checks pass; absence and pinning preserved |
| Coincident | 65 | 2 / balanced | Three ticks | Full checks pass |

In the dense case, both GPUs have a maximum force difference of about `3.66e−4` and position difference of `3.05e−4`
from CPU. They differ from each other by at most `6.10e−5`, within the unchanged component-relative budget.
A maximum absolute error alone does not determine a verdict: the reference component's magnitude matters.
The same-structure CPU check also fails, while integration from each GPU's own forces passes. This narrows the
remaining discrepancy to force evaluation / rounding and its propagation, rather than selected neighbors or the
integration stage. It does not prove a particular compiler optimization is responsible.

Unordered atomic-list accumulation previously produced a maximum WebGPU force difference of about `1.09e−3` on this
fixture. Stable source-order sums reduced it to the production WebGL level. The added construction cost has **not**
been benchmarked and the current dense-cell fallback is deliberately diagnostic.

### Approximation quality is a separate result

On the first 8,192-point uniform tick, relative L2 error on the 64 diagnostic targets is about **0.0784%** against
both exact references. At 16,384 uniform points it is about **0.700%** against production's radius split and **0.0638%**
against exact pairs using the grid partition.

The first dense-cluster tick is different: about **1.16%** against exact pairs using the grid partition, but about
**1,130%** against production's exact radius split. The near-force cap is applied to different interaction sets.
This is a material model difference at the exact-to-grid transition, not simply the sampling error or a WGSL port bug.
It calls for convergence and force-composition tests before choosing migration defaults. These subset metrics cannot
establish worst-case error or layout quality.

### Stage-by-stage precision investigation

The [precision trace](#/many-body-grid/docs/precision) locates the first M3 tolerance failures after the 64×64 far-field
level. Near-force accumulation, jitter and clamping pass. Diagnostic changes to CPU centroid evaluation remove most,
but not all, final-force failures. The original CPU reference remains the gate; these hypotheses do not establish a fix.

The [stored centroid variant](#/many-body-grid/docs/centroids) does not fix the dense failures without changing the
budget. It isolates a storage boundary, but centroid division still differs from CPU rounding on the M3. A targeted integer-count correction eliminates the checked centroid-bit differences, but leaves 2 force / 2 position
failures at 8,192 dense points and 5 / 1 at 16,384 on the M3. Inline remains the default; all six variants and their
original-tolerance verdicts stay available in the lab. The follow-up [far-field correction](#/many-body-grid/docs/far-field)
passes both dense counts over three CPU-anchored ticks on M3, using refined arithmetic and stored contributions.
The full-buffer candidate adds 38.83 / 76.33 MiB and two dispatches. The follow-up
[streamed candidate](#/many-body-grid/docs/precision-cost) reduces this to 7.96 / 14.58 MiB with thirteen extra dispatches.
Both pass all checked batches in two native M3 timing sweeps; complete-step timings show no consistent winner between
them. The inline control remains faster but fails dense CPU parity. These are bounded fixed-input results, not evidence
of production layout convergence.

### Automated coverage

Browser tests check both backends on uniform, clustered, coincident, absent/pinned and boundary fixtures over three
small same-input ticks, including both shell qualities. Large uniform tests check the complete CPU comparison.
The dense 8,192-point regression checks all structures, selected identities, WebGPU versus production output, and
integration from actual GPU forces. It deliberately does **not** assert full dense CPU parity: that remains a visible
failing diagnostic in the app for the inline path. Separate candidate tests now require full dense CPU parity at
8,192 and 16,384 points over three ticks, plus edge fixtures and a 65,024-case rounded-square corpus. UI tests ensure GPU agreement cannot turn a shared CPU mismatch into a pass, and a
missing or failed backend cannot be reported as a successful comparison. Software Chromium results are not native
performance evidence.

## Reproduce

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/
```

Open [Hierarchical global repulsion](#/many-body-grid). Start with 8,192 uniform points, eight samples per cell and precise
quality. Use **Step + validate**, then repeat with clustered and coincident inputs and both shell settings. The small absent,
pinned and boundary fixtures exercise the forced grid path below its production cutoff. Changing settings resets the run.

The table checks aggregate sums/counts, selected identities, force and integration. The same-structure column evaluates
force and integrated output against a CPU calculation from that backend's actual aggregates and selected samples. A passing local
check does not erase a failed aggregate or selection check. The GPU-to-GPU comparison and integration from GPU force
readback are additional diagnostics. A full pass requires every CPU, structural, integration and cross-backend check.

All selected identities and counts must match exactly. Present force and position components retain the exact experiment's
`2e−5 + 3e−5 × abs(reference)` budget. Stored hash values may differ by at most `2e−7`; that never permits a different selected
identity. Failed checks stop the multi-tick run. No approximation-error percentage is used to excuse a failed port check.

Export JSON retains frame bounds, seeds, parameters, device/browser information, verdicts and exact-reference metrics.
Keep raw captures local; record concise findings here. This is a readback-heavy correctness harness, not a benchmark.

## Remaining work

- GPU bounds reduction and cross-backend cell-boundary parity.
- Automatic sample-count tuning and occupancy measurements.
- Parallel construction for dense cells and million-point workloads.
- Longer trajectories, statistical quality across many seeds and force composition.
- Timing and native coverage on additional devices and browsers.
