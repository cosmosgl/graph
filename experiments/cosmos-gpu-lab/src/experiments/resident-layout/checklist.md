## Verified here

- **Zero routine CPU downloads.** GPU bounds use the positions already on the GPU.
- **40/40 layout checks matched bit for bit.** Compared with CPU bounds on chain, communities, star, and pinned graphs at 128 and 8,192 points.
- **Bounds edge cases matched the CPU reference.** Empty graphs, excluded points, pinned points, and points at the same coordinates.

## Checked separately

Both previews use the same force shaders.

- [Force accuracy](#/combined-layout?section=doc-gravity-trig) — WebGPU forces against an independent CPU reference.
- [Frame timing](#/resident-frame-timing) — GPU work and CPU time per frame.
- [Live edits](#/resident-layout-edits) — moving points and replacing links during simulation.
- [Integrated viewer](#/integrated-webgpu?section=doc-composed-interaction) — rendering and picking.
