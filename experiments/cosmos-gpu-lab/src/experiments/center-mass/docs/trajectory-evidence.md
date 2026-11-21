---
source: Recorded investigation
recorded: 2026-11-18
device: Apple M3; visible Chrome 157; luma.gl 10.0.0-alpha.15
scope: Two independently evolving community layouts, 200 ticks each
---

# Center-force trajectory evidence

The existing center-force shader and an opt-in linear candidate each evolved
their own community graph for 200 ticks. The study compared positions at the
original strict checkpoints and checked finite values, pinned points, absent
points and flags. Each graph included one pinned and one absent point.

| Points | Strict position comparison | Other recorded checks |
| ---: | --- | --- |
| 512 | Passed at every checkpoint | Finite positions, pins, absence and flags passed |
| 8,192 | Failed from tick 10 | Finite positions, pins, absence and flags passed |

At tick 200 in the 8,192-point graph, 1,103 coordinate components exceeded the
strict tolerance. The root-mean-square position difference was 0.0975 world units
and the largest was 2.404. In the shared 480 × 340 view those were approximately
0.038 and 0.941 pixels. The final still images looked similar on inspection.

The candidate had passed the existing frozen force-component tolerance on the
tested input, but that local check did not establish the independently evolving
trajectory. Two graph sizes and one view do not establish behavior across graph
families, sustained motion or other devices. The strict failure remains a failure;
the visual observation does not approve a production replacement. The original
measurement and source snapshot remain in the experiment's local research records.
