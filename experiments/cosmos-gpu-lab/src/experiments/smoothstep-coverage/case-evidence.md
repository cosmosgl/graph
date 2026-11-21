---
source: Recorded findings
recorded: 2026-11-17
device: Apple M3, Chromium 157, ANGLE Metal WebGL and Apple WebGPU; luma.gl 10.0.0-alpha.15
scope: Fixed-input scores and one frozen line in hard and shifted blended controls
---

# Line-edge evidence

Changing the edge formula changed **zero color pixels and zero IDs** on each
backend for the original hard line. The two backends still differed at **180
pixel IDs**. A separate fixed-input check returned the same scores for both
formulas on both backends.

At the inspected pixel, WebGL's score was `0.5`, while WebGPU's was about
`0.4999998`. The hard edge uses `0.5` as its draw cutoff, so these near-equal
scores can make opposite draw decisions. Separate probes predicted the observed
decision but do not prove how the ordinary draw was compiled.

When the line moved down by 1/1024 of a device pixel with a blended edge, the
backends agreed on IDs in that run. These are selected line and device checks,
not a guarantee for all geometry, drivers or GPUs.
