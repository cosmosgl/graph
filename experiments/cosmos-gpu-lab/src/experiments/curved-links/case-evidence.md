---
source: Recorded findings
recorded: 2026-11-17
device: Apple M3, Chromium 157, ANGLE Metal WebGL and Apple WebGPU; luma.gl 10.0.0-alpha.15
scope: Twenty-four frozen dashed and dotted curved-link comparisons
---

# Curved-link evidence

The color-face picking candidate passed **4 of 24** full-frame checks. All four
passing cases had zero opacity; none of the 20 visible-curve cases passed all
gates. Every case preserved its backend's original production color bytes.

| Stroke | Cases passing every gate |
| --- | ---: |
| Dashed | 2 / 12 |
| Dotted | 2 / 12 |

## What was compared

Both renderers drew the same frozen curves. Candidate IDs were compared with
independent triangle-strip masks and the unchanged production picking control.
The original ID, color, visibility and mask gates remained in force.

The 24 cases combined two scenes, two stroke patterns and six profiles, including
blended and hard edges, different pixel ratios and zero opacity. The candidate
had no invisible frame or source picks in these checks, but some CPU masks and
paired GPU color boundaries still differed.

These observations cover selected frozen curves on one device. They do not
establish behavior for all curve settings, animated graphs or other GPUs.
