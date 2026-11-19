# Mouse repulsion findings

The isolated WebGPU mouse force passed the declared M3 matrix through 8,192
points. The live preview advanced while the right button was held and stopped
after release without a second pointer move. [Declared matrix](#/mouse-repulsion?section=doc-agent-recipe)

## Behavior and numerical agreement

All 34 backend rows passed, including 22 active force and integration checks
and 12 skipped steps with exact position preservation. All 32 independent
trajectory checkpoints on the moving inputs passed. Both backends kept pins,
absent coordinates and flags unchanged. The test exercised signed strength,
translated coordinates, pan and zoom, and a change in the logical viewport
used for pointer mapping.

| Comparison | Maximum force component difference | Maximum position component difference |
| --- | ---: | ---: |
| WebGL against CPU from the same input | 4.77e-7 | 2.44e-4 |
| WebGPU against CPU from the same input | 3.58e-7 | 1.22e-4 |
| Direct WebGPU against WebGL from the same input | 4.77e-7 | 6.10e-5 |

All three direct pairs passed the existing mixed tolerance. The largest
position differences were on the translated input. The separate exact
coincidence observation returned zero force and no movement on both backends
on this machine. The WebGPU branch defines that result directly. The GLSL
arctangent leaves it implementation-dependent. [Force and guard](#/mouse-repulsion?section=doc-method-reference-and-guard)

## Isolated GPU time

| Points | WebGL median, ms | WebGL range, ms | WebGPU median, ms | WebGPU range, ms |
| ---: | ---: | ---: | ---: | ---: |
| 12 | 0.0376 | 0.0371–0.0647 | 0.0045 | 0.0045–0.0467 |
| 1,024 | 0.0372 | 0.0362–0.0785 | 0.0047 | 0.0047–0.0047 |
| 8,192 | 0.0377 | 0.0373–0.0579 | 0.0066 | 0.0063–0.0494 |

Values report GPU time per frozen force evaluation from batches of 16. All
42 measured batches and 12 warmups had valid timestamps. All six post-timing
gates passed, with positions unchanged exactly and forces within tolerance.
At 8,192 points the WebGPU median was lower and its range overlapped WebGL's.
The timings cover the force only. Layout quality and interactive frame
responsiveness need the composed pipeline.

## Precision while the pointer is held

In the integrated test on the 8,192-point chain and star, the first small
position difference appeared during a paused mouse frame. The expanded
kernel carries high and low floats through distance and force evaluation.
It matched every stored CPU force component in four separate checks,
including a translated input with negative strength. The native kernel
differed in 10,815 components on the captured 8,192-point pointer input,
with a maximum difference of 3.58e-7.

On that frozen input, the median GPU force cost rose from 0.0024 ms to
0.245 ms. The median through GPU completion rose from 0.044 ms to
0.281 ms. All 18 timestamp batches passed, and the expanded forces still
matched. The composed viewer uses this kernel. Its independent trajectories
matched exactly on the four tested graphs.
[Interactive results](#/integrated-webgpu?section=doc-composed-interaction)

The correctness and timing captures are `captures/mouse-expanded-check-mwnfws3f/`
and `captures/mouse-expanded-cost-mwnfyh8c/`. Their source archive hashes are
`f8442eaad1b539e5763d310285fd9c076ab91c8eb217ee4404e5a0769388e621` and
`d3ca295665d572d5312d99a058d087f9195f8a9971b4a46978dec47bc560a462`.

A follow-up found that a very faint force at a distance of about `1e12`
could disappear when the scale underflowed. Applying the displacement before
division in that case preserved the CPU's `1e-35` float32 result. The five
expanded correctness fixtures and the native fallback check passed in
`captures/mouse-expanded-underflow-mwngd00q/`. Its source archive SHA-256 is
`33fdb0f1030ef5a67670363090a4b4831f4ac2c1b80162893a2ca414c63d3235`.

## Source and environment

Measured on 19 November 2026 in visible Chrome 157 with luma 10.0.0-alpha.15.
The run reported ANGLE Metal Renderer Apple M3 for WebGL and a non-fallback
Apple adapter with the Metal 3 architecture for WebGPU. Both canvases were
480 × 340 CSS and backing pixels on a display with DPR 2.

The local capture is `captures/mouse-repulsion-m3-20261119-2qr6j81w/`.
`mouse-repulsion-native.json` stores the checks, timings and adapter identities.
The source archive includes the working tree and lockfile at base revision
`d329feaffe12bfea0ea3e3f768befcb0ca0e6b4b`. Its SHA-256 is
`5088b10e8ba596c79f4c83310a23664f8f4f99e5d2ad81178f9efc5a7584df46`.
