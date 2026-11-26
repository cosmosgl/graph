# Recorded evidence

- **Frame and picking targets.** On the recorded M3, the 1,024-point chain met both targets and the 8,192-point star missed the frame target. [Results](#/integrated-webgpu?section=doc-findings) · [Protocol](#/integrated-webgpu?section=doc-method) · [Composed-force checks](#/integrated-webgpu?section=doc-composed-interaction)
- **Karate Club.** Fit brought all 34 points into view, but one pick took 68.2 ms against the 50 ms limit and a passing replay left the delay unexplained. [Fit chart and measurements](#/integrated-webgpu?section=doc-findings-cooled-karate-club-readability-and-exploration) · [Replay](#/integrated-webgpu?section=doc-findings-bounded-cooled-picking-replay)
- **Device recovery.** The host kept drawing after layout cleanup, and a manual restart restored all 128 saved position values. [Recovery study](#/integrated-webgpu?section=doc-host-ownership)
- **Tracked positions.** All eight requests returned the expected coordinates in order, including overlapping snapshots. [Tracker checks](#/integrated-webgpu?section=doc-tracked-points) · [Selection and labels](#/integrated-webgpu?section=doc-readback)
