# Composed forces with real pointer input

In **First integrated WebGPU graph**, choose **Composed forces** and click
**Replace graph / reset**. Hold the right mouse button over the graph to
repel points while paused or running. The cluster and attractor buttons
update their inputs at the current tick. **Composed with collision** adds
two collision passes. It checks every pair through 4,096 points and uses
hashed neighbors up to 8,192 points.

## Comparison

Replay the actual pointer input on a 961 × 541 CSS canvas at DPR 2. Compare
WebGPU and an independently evolving CPU reference after each of 64 ticks
and each paused pointer frame. Check pan, zoom to 3.32× Fit, right-button
hold and release, point clicks, cluster membership replacement, and
attractor disable and replacement. Karate Club and the 256-point community
graph include two exact collision passes. The 8,192-point chain and star
use hierarchical repulsion.

Project each corresponding point and its motion into the same camera and
require differences of at most one backing pixel. Keep the original strict
numeric checks, pins, absence flags and finite positions. Reconstruct the
first differing and failed ticks from their saved inputs. Replay each stage
on the actual GPU stage inputs and compare to the CPU stage result. Then
compare with the independently evolving layout to locate where motion diverges.

Measure the 8,192-point chain and star in separate viewer runs. After eight
warmup frames, record 48 consecutive frame intervals without intermediate
readback. Follow with a deep zoom, held pointer repulsion and eight clicks.
Compare frames with 33 ms and each pick with 50 ms.

## Native pointer arithmetic

Visible Chrome 157 on M3 reported a non-fallback Apple Metal 3 WebGPU
adapter with luma 10.0.0-alpha.15. Checked movement, release, channel changes,
pan and zoom, point IDs, finite positions, pins and absence. Position and
motion pass the one-pixel screen on both small graphs. The larger chain
and star fail it.

| Graph | Largest projected position / motion difference | Strict position / final-force checks |
| --- | ---: | ---: |
| Karate Club, 34 | 0.00202 / 0.00139 px | 51/68 · 68/68 |
| Communities, 256 | 0.03370 / 0.00965 px | 13/68 · 24/68 |
| Chain, 8,192 | 128.26 / 126.17 px | 5/68 · 6/68 |
| Star, 8,192 | 622.32 / 152.59 px | 5/68 · 5/68 |

The first paused pointer frame on each large graph differs by at most
0.00000381 world units. The chain first fails the screen at zero-based tick
5, with a 39.62 px difference before zoom. Each same-input stage of that
tick matches CPU exactly. The star first fails at tick 4, with a 1.13 px
difference while the pointer is held. Its same-input pointer stage passes
the strict tolerance and subsequent stages match CPU exactly. Staged GPU
positions match normally composed GPU positions in both replays.

| Graph | Frame median / p95 | Frames ≤33 ms | Picks ≤50 ms | Slowest pick |
| --- | ---: | ---: | ---: | ---: |
| Chain, 8,192 | 16.7 / 34.8 ms | 45/48 | 8/8 | 26.1 ms |
| Star, 8,192 | 16.7 / 49.2 ms | 40/48 | 7/8 | 52.7 ms |

Both miss the 95% frame target. The star also misses the per-pick target.
These live timings cover the renderer's frame cadence and feedback
opportunity through the browser.

The baseline capture is in `captures/composed-interactive-m3-6d7c44f1/`.
Its source archive SHA-256 is
`74f49260ffb99855622416c646784c3a1467b572532dd9cf38995448f5a1fc56`.

### Where the difference grows

A second native replay saved the first differing, strict-fail and
one-pixel-fail inputs. The same-input pointer force explains the first
coordinate difference while paused. At the first one-pixel failure on
each graph, the maximum coordinate error grew during point repulsion
from 0.026 to 1.064 world units on the chain and from 0.0084 to 1.072 on
the star. The CPU reconstruction gave the same grid-cell assignments and
selected neighbor IDs on both inputs. Replaying repulsion on identical
positions matched exactly. Small differences in the incoming positions
were enough to change the push.

The first two diagnostic attempts hit the capture size and file-name
checks (`composed-input-m3-03f8d7d2` and `composed-grid-witness-m3-db969f2b`).
The completed diagnostic is in `captures/composed-grid-witness-m3-822453d3/`.
Its source archive SHA-256 is
`b259467ca617fb77b07511bee85db460e724ac63386ab3381b1650c8f538f345`.

## Pointer precision correction

The composed viewer keeps a high and low float through mouse distance and
force calculations before storing the force as a single float. The force
law and CPU reference are unchanged. The isolated force pass on the
8,192-point input matched every CPU component, with median GPU time rising
from 0.0024 to 0.245 ms while the pointer is held.
[Mouse force measurements](#/mouse-repulsion?section=doc-findings)

With the corrected force, all four graphs matched the independent CPU
coordinates and final forces exactly at all 272 checkpoints. Maximum
projected position and motion differences were both zero. The replay
included paused and running pointer frames, zoom, and live replacements.

| Graph | Frame median / p95 | Frames ≤33 ms | Picks ≤50 ms | Slowest pick |
| --- | ---: | ---: | ---: | ---: |
| Chain, 8,192 | 16.7 / 18.3 ms | 48/48 | 8/8 | 18.8 ms |
| Star, 8,192 | 16.8 / 49.7 ms | 40/48 | 8/8 | 29.4 ms |

The star still misses the frame target. Steady frame timing runs with
the pointer up, so the table describes viewer responsiveness across
two sessions. The isolated GPU timing measures the arithmetic cost.
Larger graphs, other devices and production styles need separate checks.

The corrected capture is in `captures/composed-expanded-m3-5d1f08f7/`.
Its source archive SHA-256 is
`1d8607e3f9b7e6bdb0a7d18b56e0360d303f654a51f5145c277ffded80bc5fe3`.

## Full force set with hashed collision

Add an 8,192-point community graph with two hashed collision passes. Each
pass builds its slots from the latest GPU positions and applies the next
collision correction before the following pass. The five graphs passed all
340 independent checkpoints, with zero measured position, motion or force
difference after the pointer precision correction. The real input and
live channel checks passed on every graph.

In a separate frozen 8,192-point community replay, two collision passes
raised median GPU compute and draw time from 7.63 to 9.71 ms. The paired
median increase was 2.03 ms across seven measured pairs.
[Hashed collision timing and WebGL comparison](#/collision?section=doc-hashed-findings)

The latest live chain and star had frame p95 values of 33.6 and 49.3 ms.
They met 33 ms in 45/48 and 40/48 intervals, respectively. All 16 clicks met
50 ms. The two live timing lanes used composed forces with collision off;
see the frozen replay for the cost of collision. The larger graphs and
production frame targets remain open.

The full-force run is in `captures/composed-all-forces-m3-0d47b0f0/`.
Its source archive SHA-256 is
`50de858393da597769e97a72c541822dcd920908e528cb0dfea45c7034cd99a5`.

## Reproduce

Set a unique `LAB_ARTIFACT_RUN`, `LAB_SOURCE_REVISION` and
`LAB_SOURCE_SNAPSHOT` using the Lab README. Use the local visible browser.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_COMPOSED_INTERACTION=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/integrated-webgpu/composed-interaction.test.ts
```

Set `VITE_LAB_MOUSE_ARITHMETIC=native` to replay the baseline with the
original pointer calculation and retain the failed screen checks.
