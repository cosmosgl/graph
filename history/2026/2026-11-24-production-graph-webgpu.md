# Running the same Cosmos example on WebGL and WebGPU

Cosmos will move to WebGPU. While the replacement is being built, we need to
see what an application does on the existing Graph and run the same code on
the candidate. Keeping one story source makes differences in picking, camera
position and force behavior reproducible.

The private WebGPU workspace package exposes its own Graph and GraphSimulation.
The two Storybook previews resolve the application import to their respective
engines. The GPU Lab can also load the two standalone builds in separate
frames, with the workspace build serving as the WebGL reference until cutover.

Comparing the position buffers and the rendered pixels separately caught a
drawing difference after the first collision step. The centers agreed, but
the WebGPU circles painted a fringe outside the WebGL point sprite once they
moved between pixels. Matching the sprite bounds, subpixel center rounding
and coordinate interpolation restored exact paint on both collision fixtures.

The Points comparison exposed a shared cause across eight different shapes.
At a diameter of 22.3 CSS pixels, the Apple M3 WebGL rasterizer rounded the
sprite bounds before assigning coordinates to edge pixels. The WebGPU shader
now accounts for this rounding while preserving the shape's requested size.
A second offset exposed one-level color differences from interpolation across
a triangle. Centers placed halfway between device-grid positions exposed how
SwiftShader independently rounds the projected center and corners. Keeping
both placements in the Lab lets us check these edges with the same application
and exact RGBA comparison as the original four diameters at both pixel ratios.

Links exposed a different compatibility requirement. WebGL lets a pointer
select a thin link several pixels beyond its painted edge and inside a dash
gap. Checking both the canvas pixels and the public click callback preserves
that behavior when an endpoint moves or a point covers the link.

The point-label story exposed a timing difference. Halfway through a size
change, WebGPU painted the point at 12 but told the label its size was
already 20. The point-radius and link-width getters now follow the same
clock as the drawing, so a label can stay in place relative to the point
without reading pixels back. When a second edit arrives mid-animation,
WebGPU starts at the displayed size. WebGL jumps to its previous target.
The paired replay checks the label and painted geometry in both cases.

Running one force at a time also exposed a difference in how a host drives
the Graph. Holding the right mouse button must repel nearby points during
a manually scheduled update. Reading the positions after each update lets
us check the impulse, the release and the pinned point separately.

The 22,500-point Lasso Selection story looked different even before drawing
a lasso. Giving both engines the same mesh and force seeds in the Lab replay
exposed a second difference. The WebGPU tree grouped nearby points together, so the cloud
expanded less on the first step and the settled clusters kept shimmering.
WebGPU now computes nearby pair forces and groups distant cells using the
WebGL rules. On M3 the first-step radius agreed within 0.005 graph units.
After subtracting each cluster's translation, its members moved 0.04374
units per tick on WebGPU and 0.04383 on WebGL over ticks 240–248.

The first corrected WebGPU step spent more time preparing grid pipelines
than executing the repulsion shaders. Reusing the leaf pass to select
neighbors and clear occupied cells reduced startup work. We kept the grid
bounds in their own pass after a faster prototype changed coordinates at
tick 3. On M3 the optimized force reproduced every point position in the
previous WebGPU build at all 13 lasso checkpoints through tick 248.

On the moving million-point YouTube graph, rectangle selection and 1,000
tracked labels shared the GPU queue with simulation and drawing. A pointer
release could find four or five frames already submitted. Most of the wait
for either answer came from work that preceded the queries. The WebGPU
Graph now waits for its previous automatic frame to complete before
submitting another. Hosts can still step or draw explicitly. Replaying
the same drags at the same simulation ticks preserved every selected ID.

The Deck marker demo could draw from a shared device, but it did not run
the layer an application imports. Installing both candidate tarballs in a
clean app exposed a failure that a screenshot alone would miss. The points
and link drew correctly, yet Deck could not pick any of them. Deck 10 passes
its picking layer ID in the blend constant. Forwarding that ID let Deck
return the original records before and after a resize. Removing the layer
also showed that the app could keep editing a Graph it had supplied.

## Example

Open **Examples → Get Started → Manual step** in both previews. Click either
endpoint to see its ID, then step gravity. The red point stays pinned while
the blue point moves and the link follows.

In the GPU Lab, **ForceCollision in the Cosmos packages** uses the same
overlapping circles on both engines. Step either collision case to compare
every position and pixel in the two builds.

In **Lines in the Cosmos packages**, select Dashed and move the endpoint to
compare both the stroke and its click target. In **Forces in the Cosmos
packages**, step Pointer repulsion through the fourth update and release.
