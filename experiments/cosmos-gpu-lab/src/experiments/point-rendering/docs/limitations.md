# Next rendering steps

This first rendering experiment proves only the circle primitive. It is intentionally too small
to choose the final production renderer or claim a performance winner.

## Add before performance conclusions

1. Keep positions GPU-resident and feed the WebGPU renderer directly from simulation buffers.
2. Add camera pan/zoom and confirm screen-space versus world-space size semantics.
3. Test hundreds of thousands and millions of points with GPU timestamp queries where available.
4. Compare six duplicated vertices with a four-vertex indexed quad and other expansion strategies.
5. Measure overdraw for large translucent circles and dense clusters.
6. Validate minimum-size coverage and high-device-pixel-ratio behavior.

## Rebuild the Cosmos feature surface incrementally

- per-point size and opacity;
- square, triangle, diamond and other signed-distance shapes;
- strokes and highlighted-point rings;
- images and the atlas resource/view model;
- point render order and optional depth/occlusion passes;
- GPU picking and selection;
- enter/exit and style transitions;
- host-provided render passes for deck.gl integration.

The important design constraint is to keep this expansion reusable. Position, color, size, shape
and status buffers should be consumable by simulation, picking and rendering without CPU readback
or duplicated authoritative state.
