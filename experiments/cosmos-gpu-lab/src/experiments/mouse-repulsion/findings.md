# Mouse repulsion findings

The isolated WebGPU mouse force passed the declared M3 matrix through 8,192
points. The live preview advanced while the right button was held and stopped
after release without a second pointer move. Simulation composition and
end-to-end input latency remain open. [Declared matrix](#/mouse-repulsion?section=doc-agent-recipe)

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
