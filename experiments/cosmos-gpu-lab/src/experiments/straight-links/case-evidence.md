---
source: Recorded findings
recorded: 2026-11-17
device: Apple M3, Chromium 157, ANGLE Metal WebGL and Apple WebGPU; luma.gl 10.0.0-alpha.15
scope: Twenty-four frozen dashed and dotted straight-link comparisons
---

# Straight-link evidence

The visible-footprint picking candidate passed **14 of 24** full-frame checks.
Both backends preserved their original production color bytes in every case,
and the latest two replays found no invisible frame or isolated-source picks.
The remaining mask or color-boundary failures still prevent full acceptance.

| Stroke | Cases passing every gate |
| --- | ---: |
| Dashed | 6 / 12 |
| Dotted | 8 / 12 |

## What was compared

Both renderers drew the same frozen links. The candidate's picked IDs were
compared with independent scalar masks and with the unchanged production ID
control. The checks retained exact ID matching, the existing color tolerance,
and a requirement that picked sources are visible.

Two scenes were checked with six profiles, including blended and hard edges,
different pixel ratios, reversed gradients and zero opacity. Earlier runs
reported invisible picks in one profile that did not recur in the latest
replays; the cause was not established.

These results describe the selected fixtures on one device. They do not cover
arbitrary pattern settings, animated updates, rendering cost or all GPUs.
