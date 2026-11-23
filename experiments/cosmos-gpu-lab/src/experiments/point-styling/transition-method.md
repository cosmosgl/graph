# Point transitions and exits

Can WebGPU match the production same-count position, fill and size transition
with NaN-based enters and exits? The WebGL control runs the unchanged production
position interpolation fragment. A float readback probe uses the production
exit and size functions and the fill resolve and interpolation expressions
from the point vertex shader. The independent CPU reference computes the
same rules from the fixture. Only the selected channels enter the probe.

Nine stable point IDs exercise normal interpolation, default and explicit
styles, missing color components, zero size, an enter, an exit, a persistently
absent point and a re-enter. Check 12 fixed times across three 100 ms linear
cycles, including progress 0 and 1, a color-only probe and a restart at 37.5 ms.
Positions restart from a GPU copy of the last rendered position. The source
fill and size come from the previous target data, as production does. Exit
history comes from the previous and current target absence flags. An exiting
point holds its last position while the target absence flag is already set.

Every frame compares the three position and style outputs at `2e-5 + 3e-5 ×
abs(reference)`. IDs, target absence, the draw guard and unused position
alpha metadata are exact. NaN coordinates must stay NaN when both position
endpoints are absent. The test checks position continuity at restart and
the previous-target start of fill and size separately. Style-only progress
must use settled target absence so it cannot replay a completed fade. The
style probe checks size, exit fraction, target absence, nonzero-size draw
eligibility, and four fill channels before rasterization.

This is a native M3 compatibility check at fixed point count. It excludes
stroke and link transitions, images and rings, count changes, full raster
and picking behavior, the easing/timing scheduler, callbacks, live setters,
sparse writes and simulation coordination. The probes perform readbacks
for validation. The position restart itself uses a resident copy on both GPUs.

The [archived transition test](https://github.com/cosmosgl/graph/blob/08e5ff5dd3ffdd4ca970a7bd96f22d7d3778a468/experiments/cosmos-gpu-lab/src/experiments/point-styling/transition.test.ts)
contains the inputs and assertions for this study.
