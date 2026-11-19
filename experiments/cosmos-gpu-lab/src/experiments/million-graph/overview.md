# Million-point moving graph

Press **Run graph** to watch a synthetic graph of up to one million points.
Every tick builds the spatial index and hierarchy on the GPU, calculates
gravity, repulsion and link springs, and draws the current points and links.
The camera fits the moving graph on the GPU; positions are not read back while
it runs. Pause or reset to stop the simulation.

Under **Configuration**, choose evenly spread points, two dense clusters or
eight dense communities held together by local springs to fixed anchors.
**Per point** evaluates distant clusters at each point. **Cell center** gives
points in the same coarse cell a shared push. **Four corners** blends four
pushes according to each point's position inside that cell. Both options rebuild
the shared values every tick and keep the nearby forces individual.

Drag the canvas to pan, use the wheel to zoom and click a point to highlight
it. Fit returns to the GPU's automatic framing. The recorded M3 view tests
pan, zoom and picks while the graph moves and reports frame intervals
separately from synchronized ticks. The prototype uses basic circles and solid
links. Production styles, point dragging and the full force set remain open.
[Moving graph interaction](#/million-graph?section=doc-interactive-study)
