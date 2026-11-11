# Smaller link-force textures

Large linked graphs reserved two entries per input link in each of the two
directional force passes. Each directional adjacency actually contains each
valid link once. Reserving one entry per link removes the duplicated capacity.

The spring also needs only five floats per adjacency: two neighbor texel
coordinates, bias, square-root strength, and seeded distance variation. Store
the first four together in RGBA32F and the last in R32F, replacing three
RGBA32F textures per direction. Values retain float32 precision, adjacency
order and random-number consumption; the spring equations and loop bound are
unchanged.

For 6,898,769 links the directional link textures shrink from 1,324,917,600
to 276,045,160 bytes. This excludes per-point metadata, renderer resources,
driver copies and upload peaks. The temporary CPU upload arrays shrink too;
neighbor coordinates are no longer retained in a separate class field.

Permanent real-WebGL regressions compare both directional spring passes with
pre-packing reference velocities, including adjacency row crossings, invalid
endpoints, self/duplicate links and explicit/fallback strengths. They also
check square-capacity boundaries, texture reuse and destruction, zero-strength
updates, point-count shrinkage, and clearing/restoring links and points.
