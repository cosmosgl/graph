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

Running one force at a time also exposed a difference in how a host drives
the Graph. Holding the right mouse button must repel nearby points during
a manually scheduled update. Reading the positions after each update lets
us check the impulse, the release and the pinned point separately.

On the moving million-point YouTube graph, rectangle selection and 1,000
tracked labels shared the GPU queue with simulation and drawing. A pointer
release could find four or five frames already submitted. Most of the wait
for either answer came from work that preceded the queries. The WebGPU
Graph now waits for its previous automatic frame to complete before
submitting another. Hosts can still step or draw explicitly. Replaying
the same drags at the same simulation ticks preserved every selected ID.

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
