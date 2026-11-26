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

A click 46 CSS pixels from the center of a 96-pixel image fell through
to the link below it. WebGPU had inherited a 64-pixel point limit even
though its renderer draws triangles. Drawing and picking now use the
requested diameter. The same image exposed a color difference. A red
fill assigned to an absent shape made half-transparent red too bright.
Starting with transparent black and matching WebGL’s atlas sampling
gave both packages RGB (64, 127, 0) over the green link. On M3, both
returned point 2 at the outer click at 1× and 2×.

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

The pointer used the new target size as soon as an edit arrived. A click
could therefore change from background to point 0 while the point on
screen was still 24 pixels wide. WebGPU now picks using the size from
the last drawn frame, with the usual pointer tolerance. In the M3
replay, clicks 20 and 22 CSS pixels below the center returned point 0
and background on both sides of the interruption. WebGL held its last
hit, point 2, until the size transition finished.

Recoloring a point can change a link’s gradient because the shader reads
the endpoint colors when it draws. The link record itself stays the same.
Previously each point edit uploaded 256 KiB of links on the 8,192-link
fixture. Updating the point records in place brought that to zero, even
when a second edit arrived mid-animation. That replay also caught a
32-pixel circle drawing square on M3. Placing a static circle at the same
tile boundary reproduced it. Keeping the zero coordinate exact restored
the circular edge at both pixel ratios.

Removing a point exposed two different lifetimes for the same slot. Its
ID leaves picking, tracking and the simulation as soon as either position
coordinate becomes NaN. Its last finite position still anchors the point
and its incident links while they fade. Restoring the slot somewhere else
after that fade uses the old location as the start of the move. Checking
the canvas and click callbacks at the same instant caught a second detail:
WebGL's pointer window can select the returning point just outside its
painted edge.

Two label groups can follow the same point and still have different
lifetimes. The WebGPU simulation now gives each tracker its own indices
and completed position map. Changing or destroying one group discards
its pending read. The other group can finish reading the tick it asked
for and follow the next one. On M3, both packages reported point 1 at
x = 2140 in the surviving request and at about 2130.8 after gravity
stepped. WebGPU callers can await `positionsAsync()` for that tick or
use the completed map while a newer GPU copy is pending.

With the mouse parked, a point could move beneath it without a hover
callback or a ring in WebGPU. The graph now checks the last cursor
position when the scene changes and combines changes that happen during
a pending pick. Once the callbacks matched, the replay showed a wider,
brighter ring. WebGL paints the hover ring above the point sprites at
70% opacity. Following that rule matched all nine frames at both pixel
ratios on M3, including the handoff from one point to another.

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
