# Cluster attraction findings

**The isolated force is good enough to move to the next missing force.** Both
backends pass the declared checks through 8,192 points at the unchanged gates.
WebGPU is faster in the two large-group cases; it is not faster for every input.
This does not add clusters to the integrated pilot yet.

## Native cluster comparison

Recorded 18 November 2026 in the visible inline Chromium 157 browser on the
user’s M3, with luma 10.0.0-alpha.15. WebGL identified ANGLE Metal / Apple M3;
WebGPU reported Apple / metal-3, fallback false. Both exposed timestamp queries.
Each GPU canvas had a 480 × 340 attachment, displayed at 304.5 × 216.27 CSS pixels
in a 663 × 827 browser viewport at DPR 2. The preview used fixed attachment
resolution rather than a DPR-scaled production renderer.

One planned run completed all nine inputs, with no runtime errors or missing
rows. Production shaders and numerical tolerances were unchanged.

| Check | Result | Scope |
|---|---|---|
| WebGL versus CPU | 45/45 rows pass | Sums, force, integrated positions and independent trajectory at ticks 1, 2, 10, 30, then one membership/target/strength update |
| WebGPU versus CPU | 45/45 rows pass | Same checks and inputs |
| WebGPU versus WebGL | 18/18 rows pass | Identical input at tick 1 and after the update |
| Post-timing group sums | 18/18 pass | Batches recompute one aggregate rather than accumulating 16 copies |
| Small-case and navigation regressions | 19/19 pass | Semantic masks, empty groups, repeated reduction, data replacement, finding schema and roadmap links |

The eight-point case covers a pinned contributor, absent finite and NaN
positions, an unassigned point, a singleton, an empty group, a negative supplied
target and varied/zero point strength. The larger cases cover 16 balanced
groups, one large group with 15 singletons, one group, and 16 supplied targets.
Present positions start within roughly ±64 world units around the origin;
large coordinate offsets and extreme force magnitudes were not tested.
The focused checks also cover all-unassigned and all-absent inputs and recreating
the comparison at different data sizes.

## Force cost

```result-chart
{
  "title": "WebGPU was faster with uneven cluster groups",
  "context": "Median isolated force time · Uneven groups at 8,192 points · Apple M3",
  "unit": "ms",
  "bars": [["WebGL",1.711],["WebGPU",0.397]]
}
```

Milliseconds per force evaluation: **median (minimum–maximum)** of seven valid
GPU timestamp batches, each divided by 16 evaluations. Two warmups per input
and backend were excluded. Backend order alternated. No builds or tests ran
during measurement; CPU validation, readback, uploads and drawing were outside
the measured intervals. Reduction and attraction were inside them; integration
was not. The fixed plan produced 126 measured batches and 36 warmups.

| Input / points | Production WebGL, ms | WebGPU candidate, ms |
|---|---:|---:|
| semantics/8 | 0.270 (0.066–0.579) | 0.369 (0.295–0.475) |
| balanced/1024 | 0.183 (0.064–0.512) | 0.381 (0.311–0.475) |
| uneven/1024 | 0.706 (0.222–0.918) | 0.524 (0.410–0.696) |
| single-group/1024 | 0.794 (0.350–1.159) | 0.406 (0.336–0.537) |
| targets/1024 | 0.233 (0.067–0.794) | 0.406 (0.303–0.688) |
| balanced/8192 | 0.299 (0.125–0.813) | 0.639 (0.524–1.319) |
| uneven/8192 | 1.711 (1.387–1.992) | 0.397 (0.324–0.475) |
| single-group/8192 | 1.436 (1.061–2.090) | 0.328 (0.291–0.360) |
| targets/8192 | 0.392 (0.200–0.654) | 0.643 (0.487–0.795) |

At 8,192 points, the uneven and single-group medians favor WebGPU by about
4.3× and 4.4× respectively. Their observed ranges do not overlap. The balanced
and supplied-target medians favor WebGL, but their ranges overlap: this is one
short session, not a stable ranking across devices or application loads.

A plausible explanation is that the WebGL blend has more contention when many
points write one group texel. The grouped WebGPU reduction distributes that
work. This run did not isolate contention, so that explanation remains a
hypothesis. The current candidate always reduces centers even for supplied
targets, matching this control’s workload; skipping those reductions is a
possible later optimization, not a measured result here.

## Decision and remaining work

- **Strict compatibility:** passes the declared isolated cluster matrix only.
  Existing production color and picking counterexamples remain rejected.
- **First-slice usability:** clusters are not yet integrated. Force timings do
  not establish complete-frame or interaction performance.
- **Full migration readiness:** not ready. Continue with per-point attractors,
  then mouse repulsion, then compose accepted forces in production order.

Do not tune cluster arithmetic further solely to improve this table. Preserve
this baseline and measure added whole-frame cost when composing the force.
Longer cooling trajectories, production setters/cache/labels, more than 64
cluster slots, update latency and other devices remain unchecked. The pilot’s
100.4-ms and 68.2-ms picking failures remain unresolved; its 50-ms target and the
95%-within-33-ms frame target are unchanged.

## Reproduction and retained evidence

Use the [fixed recipe](#/cluster-attraction?section=doc-agent-recipe). The new
finding record carries the exact clean source revision. Source records before
and after the measurement agree. The original JSON export, analysis, plan,
environment, screenshots and checksums are retained locally in
`captures/clusters-20261118-x9_mzqdc/`. Raw measurements remain ignored; **Export
JSON** remains available in the live experiment.
