# Consistent overlap selection

Rectangle selection included points whose centres lay outside its outline,
while the lasso selected by centre alone. Both tools now select a point when
its selection footprint touches or overlaps the area. This makes large
points respond consistently when either outline reaches them.

## Selection contract

Both queries use resolved target sizes, the current zoom, the one-device-pixel
floor and the hardware size cap. Untextured circles and squares use their
base shape geometry; other shapes and points with images use a circular
approximation. Squares share their geometry constant with the draw shader.

Rectangle overlap uses the nearest point on the rectangle, avoiding the
extra corner region introduced by padding each axis independently. The
public method normalizes both axes before the Y flip, accepting either drag
direction without passing reversed bounds to GLSL `clamp`.

Lasso overlap combines even-odd centre containment with circle-segment or
square-segment intersection. Repeated vertices are valid zero-length edges.
The scan checks the complete path rather than silently stopping at 2,048
edges. Paths still require at least three vertices, but may be degenerate:
collinear paths select footprints touching their segments, and coincident
vertices select footprints touching that location. This extends the former
centre-only polygon behavior and matches overlap selection for zero-area
rectangles.

Selection uses target sizes during size transitions and excludes outline
rings. `PointShape.None` without an image retains its circular selection
footprint despite drawing nothing. These inherited rectangle-query limits
now apply to both tools; area queries do not filter by rendered visibility.
Exact contours of other shapes, image transparency and outline rings remain
outside this change.

## GPU query design

Rectangle and polygon queries share a lazily rebuilt footprint texture. Its
R channel stores the target size and G identifies an untextured square.
Size, shape and image changes invalidate the cache, so shape-only updates
and adding or removing an image cannot leave stale selection geometry.

The lasso scan uses three optimizations together:

- Bounds calculated from uploaded float32 coordinates reject disjoint
  footprints before edge scanning. The bounds expand by the point's circle
  radius or square half-width; strict comparisons retain tangency.
- Each existing RGBA path texel stores both segment endpoints. One fetch
  supplies an edge without reconstructing an endpoint and introducing new
  rounding.
- A row-major texel cursor avoids division and modulo per edge while
  retaining segment order and intersection arithmetic.

Bounds rejection primarily helps small selections. Packing and the cursor
also reduce the scan cost of screen-filling lassos, where most points pass
the bounds check. Long paths still cost more because selection checks their
complete geometry.

## Example and verification

`Examples / Interaction / Area Selection`, implemented in
`src/stories/interaction/area-selection/index.ts`, lets you draw and move
rectangles or freehand lassos around different-size points, zoom, switch
pixel ratios and choose edge-case presets.

View updates query the displayed drag preview. Preset explanations clear
after manual interaction. Preset and resize resets use the interactive zoom
API to keep d3's wheel state synchronized with the view. Collinear lassos
converted to zero-area rectangles remain movable; the empty-drag guard
applies only to newly drawn rectangles.

Browser regressions cover all rectangle drag directions, circle/square
edges and corners, containment, repeated vertices, zero-size points,
degenerate paths, asymmetric and concave lassos, both winding directions,
zoom-scaled sizing, device pixel ratios and the hardware size cap. They also
cover shape-only updates, the circular footprint of textured squares,
image-index removal and complete scans of 2,048- and 2,051-vertex paths.
Story checks cover drag/zoom previews, preset and resize zoom continuity,
resized point placement, caption clearing and moving degenerate rectangles.

## Performance evidence

A temporary harness measured synchronous public queries, including uploads,
GPU completion, pixel readback and index extraction. The 72-workload matrix
used seeded layouts of 10,000 and 100,000 points; circles, squares and an
alternating mix; rectangle queries and 4-, 64- and 256-vertex lassos; and
bounds spanning 20%, 50% and 100% of each 800×600 viewport dimension.
Longer lassos were ellipses. Small, medium and screen-filling therefore name
the polygon bounds, not the exact filled area.

Comparisons used four warmups and eleven timed samples per workload, with
two runs per version in before/after/after/before order. The tables report
pooled median milliseconds for 100,000 mixed circle/square points on
Chromium/ANGLE SwiftShader, a software renderer.

**Latest measured implementation:** bounds rejection, packed endpoints,
row-major cursor and complete-path scanning. Its paired comparison isolated
removal of the fixed 2,048-edge scan limit. Counts and selected-index hashes
matched in all 72 workloads, whose paths were below that limit.

| Selection | 64 edges, fixed limit | 64 edges, complete path | 256 edges, fixed limit | 256 edges, complete path |
| --- | ---: | ---: | ---: | ---: |
| Small | 3.20 | 3.00 | 8.15 | 7.70 |
| Medium | 8.90 | 8.65 | 29.65 | 28.60 |
| Screen-filling | 12.10 | 11.70 | 40.90 | 39.00 |

This showed no long-lasso penalty for complete-path scanning in this matrix.
A small four-edge all-circle case increased from 1.25 to 1.60 ms; mixed
four-edge cases stayed within 0.10 ms. Complete-path correctness is the reason
for removing the limit.

**Earlier main comparison, intermediate implementation:** untouched main
(`738431aecf20be7a93f6e7692f7dc0acfc8c6fd9`) was compared with overlap
selection using bounds rejection and packed endpoints, before the cursor
and complete-path loop were added.

| Selection | 64 edges, main | 64 edges, intermediate overlap | 256 edges, main | 256 edges, intermediate overlap |
| --- | ---: | ---: | ---: | ---: |
| Small | 13.05 | 3.70 | 48.65 | 10.60 |
| Medium | 12.70 | 11.40 | 49.70 | 38.65 |
| Screen-filling | 13.00 | 15.20 | 48.65 | 53.95 |

Main selected centres, so its selected sets intentionally differ from overlap
selection. This earlier table does not measure the current implementation's
overhead against main. There is no paired untouched-main/latest-implementation
comparison, and the separate batches should not be combined into a speedup
claim. Hardware-GPU performance and frame budgets remain unmeasured.
