# Gravity accuracy evidence

On **12 November 2026**, the study compared frozen inputs with the intended linear
gravity law and the existing float32 CPU polar model. The input included 257, 1,024
and 4,096 finite points, including the origin and signed axes. The maximum absolute
force-component errors were:

| Calculation | 257 points | 1,024 points | 4,096 points |
| --- | ---: | ---: | ---: |
| CPU float32 polar | 9.733e-6 | 1.194e-5 | 1.194e-5 |
| Production WebGL polar | 1.735e-5 | 2.037e-5 | 2.037e-5 |
| Native WebGPU polar | 0.05 | 0.05 | 0.05 |
| Native WebGPU polar, excluding axis points | 1.735e-5 | 2.037e-5 | 2.037e-5 |
| WebGPU Cartesian | 3.465e-6 | 3.545e-6 | 3.545e-6 |

Production WebGL and Cartesian WebGPU passed the existing compatibility gate on
these inputs. The native WebGPU polar diagnostic reversed the vertical force at
`(0, 1)` and `(0, -1)` on this machine; those failures remain part of the result.
Its `atan2` input has a zero x component, so this observation does not by itself
establish a driver violation. The refined strict candidate is a different path.

The session used an Apple M3 host, headless Chrome 157, ANGLE Metal for WebGL,
luma 10.0.0-alpha.4, and seed 5931. The source revision was not recorded. These are
frozen-force observations; no mathematical accuracy budget, integration or trajectory
verdict, performance result, or broader device compatibility is established.
