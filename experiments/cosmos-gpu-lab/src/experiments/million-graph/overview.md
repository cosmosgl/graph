# Million-point moving graph

WebGPU draws the selected graph at its initial positions when the demo opens.
Press **Run graph** to start the simulation on that graph, or **Reset** to
restore its starting layout.
Every tick builds the spatial index and hierarchy on the GPU, calculates
gravity, repulsion and link springs, and draws the current points and links.
The GPU fits the camera when it draws the starting layout. The camera stays
fixed while the points move. Press **Pause** to stop at the current positions.

Under **Starting layout**, choose evenly spread points, two dense clusters,
dense communities held together by springs, or communities connected to a hub.
**Per point** evaluates distant clusters at each point. **Cell center** gives
points in the same coarse cell a shared push. **Four corners** blends four
pushes according to each point's position inside that cell. Both options rebuild
the shared values every tick and keep the nearby forces individual.

Drag the canvas to pan, use the wheel to zoom and click a point to highlight
it. Fit frames the current positions once. The recorded M3 view tests
pan, zoom and picks while the graph moves and reports frame intervals
separately from synchronized ticks. The prototype uses basic circles and solid
links. Production styles, point dragging and the full force set remain open.
[Moving graph interaction](#/million-graph?section=doc-interactive-study)
