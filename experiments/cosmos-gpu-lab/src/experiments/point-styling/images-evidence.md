---
source: Recorded findings
recorded: 2026-11-13
device: Apple M3; inline Chromium 157; luma.gl 10.0.0-alpha.4
scope: Four frozen image fixtures, two filters and five display profiles
---

# Point-image evidence

Four 32 × 32 images occupied a 64 × 64 atlas. They included transparent holes,
faint pixels, gradients and contrasting neighboring tiles. The comparison used
production WebGL, the WebGPU port and an independent CPU sampler. The
source-byte candidate changes picking eligibility while preserving its color pass.

Forty rows covered image-only points, images over shapes, overlap and fractional
edges, using nearest and linear filters under five display profiles. The candidate
gate required exact GPU IDs and CPU masks, no invisible picks, colors within
2/255 and unchanged color bytes relative to its control.

| Recorded comparison | Passing rows |
| --- | ---: |
| Source-byte candidate | 40/40 |
| Retained production control | 6/40 |
| Explicit-coordinate control | 14/40 |
| Production WebGL / candidate WebGPU compatibility | 0/40 |

In the native nearest overlap fixture, production's image-rectangle picking
selected an invisible foreground at 4,752 pixels per backend. The candidate
removed those selections. Production color compatibility also failed at 81
pixels across three edge profiles, with a maximum difference of 255/255; those
failures remain part of the result.

The candidate result applies to the declared atlas and frozen profiles on one
machine. It does not establish complete production compatibility, arbitrary atlas
layouts, image decoding behavior or other-device behavior.
