---
source: Recorded findings
recorded: 2026-11-16
device: Apple M3 and Linux SwiftShader
scope: 96 point-overlay configurations on each backend
---

# Point effects: recorded evidence

The study compared a pixel-distance overlay candidate with the retained implementation across four scenes, eight profiles and three views. It checked overlay colors against a CPU reference, compared the full output with that reference, and checked whether the overlay changed picking IDs.

| Check | Apple M3 | Linux SwiftShader |
| --- | --- | --- |
| Candidate overlay colors match the CPU check | 96 of 96 | 96 of 96 |
| Candidate passes the full comparison | 88 of 96 | 88 of 96 |
| Retained implementation fails the CPU color check | 0 of 96 | 17 of 96 |

The eight remaining full-comparison failures on each backend were polygon-mask boundary cases. The candidate's largest color difference from the CPU check was 1/255 on both backends; the retained implementation reached 2/255 on M3 and 12/255 on SwiftShader.

The overlay did not change picking IDs in these configurations, and the picking-only change did not change color bytes. The candidate did change rendered colors relative to the retained implementation in 35 of 96 M3 cases and 45 of 96 SwiftShader cases.

These observations cover the recorded configurations and two environments only. They do not establish general rendering compatibility or pointer-event scheduling behavior.
