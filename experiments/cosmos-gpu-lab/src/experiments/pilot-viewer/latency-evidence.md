# Selection feedback evidence

The pilot was tested with the 34-member Karate Club graph. The recorded feedback
limit is 50 ms. A feedback measurement includes the selection request, the
highlight frame and the next animation opportunity; it is not a physical-display
scanout measurement.

## Original failure

On 18 November 2026, an Apple M3 running visible Chromium 157 showed one 100.4 ms
running selection in the wider window. The correct member was selected, but the
feedback exceeded the limit. Of the 100.4 ms, 92.8 ms came after highlight
completion while waiting for the next animation opportunity. This does not
establish why the delay occurred. An earlier separate 68.2 ms failure also remains
unexplained.

The original measured source was not independently snapshotted. The selected
graph, frame windows and sampled pixel checks are described in the original viewer
findings.

## Narrow-window control

On 18 November, four blocks at 627 × 353 logical pixels and DPR 2 completed 160
selections without reproducing the delay. The slowest running selections were
18.9 ms in normal blocks and 25.3 ms with extra tracing. This was a different
window from the original failure and no runtime fix was made.

## Wider control at DPR 1

On 19 November, four blocks in visible Chromium at a 961 × 541 logical canvas and
DPR 1 completed 160 selections within 50 ms. The slowest running selection was
32.3 ms. The original wider failure used DPR 2, so this control alone could not
recreate its attachment size.

## Wider control at DPR 2

On 19 November, four blocks in standalone Chrome 157 at 961 × 541 logical pixels
and DPR 2 completed 160 selections within 50 ms. The slowest running selection
was 20.0 ms. This matched the original wider attachment size, but browser
scheduling may differ from the inline browser used for the failing observation.

All later controls ran on an Apple M3 using Apple WebGPU / Metal 3 and luma
10.0.0-alpha.15. None establishes the cause of the earlier delays or accepts
larger-graph responsiveness.
