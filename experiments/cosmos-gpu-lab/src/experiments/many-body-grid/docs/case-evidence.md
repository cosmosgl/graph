---
source: Recorded findings
recorded: 2026-11-16
device: Apple M3 inline browser and Linux Chromium 151 SwiftShader
scope: Stored-contribution variants, 8,192 and 16,384 clustered points, three CPU-anchored ticks
---

# Hierarchical repulsion evidence

Both stored-contribution variants passed the checked dense cases on the two
adapters after integer midpoint rounding was corrected. The original force
tolerance, `2e−5 + 3e−5 × |reference|`, remained unchanged.

## What was compared

For each input size, materialized and streamed contributions were checked
against the same CPU hierarchy, centroids, forces and integration at three
ticks. Positions were anchored to the CPU at each tick, so the checks measured
same-input compatibility rather than independently accumulated trajectory drift.

The default inline path was not replaced by this correction. Passing the
selected dense cases does not establish behavior on every GPU, long trajectories
or complete graph layouts.
