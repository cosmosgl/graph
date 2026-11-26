# Where the circle edge comes from

WebGL starts with a square point sprite. WebGPU builds the same square from two triangles.
Both demo shaders use each pixel’s distance from the center to fade the edge into a circle.
Production Cosmos uses a different smoothing rule.

The diameter is measured in the 480 × 340 drawing buffer. If the page displays a preview at half
that width, a 14-pixel circle appears about 7 CSS pixels wide.

This demo compares the geometry by eye. For measured results, see [point shapes](#/point-shapes)
for edge pixels and [point picking](#/point-picking) for the IDs returned where shapes overlap.
