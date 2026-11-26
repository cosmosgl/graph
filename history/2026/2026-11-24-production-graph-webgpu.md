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

In the stock scatter story, opaque points covered so much of each other
that the original blended pass took about 44 ms on M3. Drawing the
visible opaque cores first lets the GPU skip covered pixels while still
blending translucent points and edges in their original order. The
signed build drew the mixed scene in 6.3–6.5 ms and kept all 345,600
pixels identical when culling was toggled.

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

Changing a click callback halfway through the same animation made the
point and link jump to their target sizes. The renderer now keeps the
animation endpoints when a host changes unrelated configuration. It
applies highlighting to the current fill at draw time, so removing a
highlight restores the intermediate color the point has reached.

Enabling simulation while a point changed color exposed an ordering rule.
The application had queued x = 1200, then set x = 1300 when Cosmos called
its interruption callback. WebGL drew the point at 1300. WebGPU had skipped
the callback and drew it at 1200. The rebuild now runs that callback before
applying pending data. If the callback destroys the graph, queued edits stop
there. Changing the world origin alone can leave the animation running.

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

The California–Nevada Roads map used one point color and size, but WebGPU
requested more than 181 MB to store the same style for every road point.
One inherited record and a list of exceptions brought the full map within
a 128 MiB binding limit. Enlarging point 31459 then changed the click at
the same screen pixel from 31462 to 31459. Restoring the inherited size
brought back the original pick. A rejected edit leaves the last good
positions and sizes available to selection as well as drawing.

The ten-million-point example exposed a separate limit. Its four floats
per point occupy 160 MB before drawing starts. Asking a capable device
for that binding keeps the buffer layout used by custom renderers and
lets the website submit one draw. Compute jobs span several rows so
stepping or selecting points near the end still reaches their original IDs.

Removing a point exposed two different lifetimes for the same slot. Its
ID leaves picking, tracking and the simulation as soon as either position
coordinate becomes NaN. Its last finite position still anchors the point
and its incident links while they fade. Restoring the slot somewhere else
after that fade uses the old location as the start of the move. Checking
the canvas and click callbacks at the same instant caught a second detail:
WebGL's pointer window can select the returning point just outside its
painted edge.

Cosmos 3.6.1 made footprint contact the default for both area tools.
A lasso edge 18 CSS pixels from the center of a 40-pixel point selected
it in WebGL while WebGPU missed it. Both canvases were identical. The
WebGPU queries now use the same target footprint for rectangles and
lassos, include tangent edges, and switch to center tests when requested.
A point with a zero target size drops out of either selection. The paired
tests exercise both rules at both pixel ratios, including a lasso whose
decisive edge occurs after 32,768 vertices.

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

A long zoom to a point skipped the wider view WebGL uses to show where
the target lies. Both engines now visit that midpoint before zooming in.
A wheel gesture or a newer camera command cancels a pending flight, even
if its target position is still being read. Destroying the graph also
makes its public geometry and view reads empty immediately, without
allocating arrays for the discarded points and links.

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

Even with one frame in flight, a new unhighlighted frame could start in
the two or three milliseconds between the selection IDs and the label
positions arriving. The highlight then waited behind another draw of
2.85 million links. After an area request, the automatic loop now gives
the pending reads one refresh to finish. Across eight moving drags on
M3, the median time from release to visible feedback fell from 647 to
551 ms. A host that steps explicitly still controls its own draws.

The million-point hub also exposed extra work after the layout paused.
Replacing its links drew the graph immediately, scheduled another draw
for the same scene, then drew once more when the host asked for a frame.
WebGPU now keeps the immediate draw and the host's draw. A trace at tick
58 caught a similar extra read when Chrome sent a mousemove at the
position it had just sampled before a click. A repeated move still reaches
the application. If the canvas pixel and scene are the same, the click
performs the only new pick and returns the current point.

The Deck marker demo could draw from a shared device, but it did not run
the layer an application imports. Installing both candidate tarballs in a
clean app exposed a failure that a screenshot alone would miss. The points
and link drew correctly, yet Deck could not pick any of them. Deck 10 passes
its picking layer ID in the blend constant. Forwarding that ID let Deck
return the original records before and after a resize. Removing the layer
also showed that the app could keep editing a Graph it had supplied.

The full-canvas app missed a failure in the Mini Graphs story. Its Deck
thumbnails start partway across the canvas. WebGPU placed point centers
in the correct view, then evaluated their shapes using pixels measured
from the edge of the framebuffer. Points could disappear while links
still drew. Accounting for the viewport origin made the red and green
centers visible and pickable in an offset host pass.

A real drag in the same thumbnail picked the right point but left it at the
press position. Deck’s asynchronous picking kept the original pick coordinates
as the pointer moved. The layer now keeps the point ID and viewport from the
press and reads the current canvas position from each gesture. In the packed
app, releasing the pointer left point 0 pickable at its new location in both
the main view and the quarter-scale thumbnail.

Firefox exposed a link shader failure while opening the packed Deck app.
The shader disabled a derivative check on an individual branch, a form
Firefox could not compile even for a solid link. The general link shader
now calculates how dash and dot coverage changes across adjacent pixels
before choosing the pattern. The separate solid-link shaders still take
the fast path. All 40 packaged Lines captures on M3 retained their
previous pixel and picking results.

## Example

In the GPU Lab, open **Run the same Graph application** and choose **A pinned
point and a moving endpoint**. Click either endpoint to see its ID, then step
gravity. The red point stays pinned while the blue point moves and the link
follows.

In the GPU Lab, **ForceCollision in the Cosmos packages** uses the same
overlapping circles on both engines. Step either collision case to compare
every position and pixel in the two builds.

In **Lines in the Cosmos packages**, select Dashed and move the endpoint to
compare both the stroke and its click target. In **Forces in the Cosmos
packages**, step Pointer repulsion through the fourth update and release.
