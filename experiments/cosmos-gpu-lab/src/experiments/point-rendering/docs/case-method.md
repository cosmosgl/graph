# How the circle comparison works

Both panels use the same positions, colors, canvas size and circle diameter.
Each backend makes one draw call.

| | WebGL | WebGPU |
| --- | --- | --- |
| Geometry | One point sprite per circle | One quad made of six vertices per circle |
| Circle coordinates | Supplied by the point-sprite pipeline | Supplied by the quad's vertices |
| Edge | Fragment distance and derivative-based coverage | The same intended coverage rule |

WebGPU's portable point primitive does not provide the wide programmable point
sprite used here, so this example expands each point into a quad instead.

This is a visual comparison. It does not measure pixel parity or test other
shapes, images, picking, transitions or full application behavior.
