Chrome 157 · M3 (Metal)

A case passed when both WebGL and WebGPU returned the exact point IDs expected by the CPU calculation, in the same order.

## Which dots count at the edge?

| Test case | Result |
| --- | --- |
| **Rectangle edge.** A dot is selected when its bounding box just touches the rectangle, even if its center is outside. | Passed |
| **Tiny dots.** At two device pixels per CSS pixel, rectangle selection uses a minimum diameter of one device pixel. | Passed |
| **Zero size.** Setting the global point size scale to zero makes the rectangle return no IDs. | Passed |
| **Lasso edge.** For a square lasso, centers on the left or bottom edge count, while centers on the right or top edge fall outside. | Passed |

## Does the way you draw the lasso matter?

| Test case | Result |
| --- | --- |
| **Inward notch.** A concave lasso excludes dots in the notch even when the path repeats its starting vertex at the end. | Passed |
| **Drawing direction.** Tracing the same square in reverse returns the same IDs in the same order. | Passed |
| **Two vertices.** A two-vertex path returns an empty selection before either GPU runs. | Passed |
| **Repeated vertex.** A path made of three identical vertices encloses no points. | Passed |
| **Exactly 2,048 edges.** A square path padded with repeated vertices still selects the expected dots at the current edge limit. | Passed |
| **Beyond 2,048 edges.** When the closing edge falls past the cutoff, WebGL and WebGPU both select the same 15 points. | Passed |

## What changes when you pan or zoom?

| Test case | Result |
| --- | --- |
| **Fixed dot sizes.** After panning and zooming, the rectangle selects 10 dots when their sizes stay fixed on screen. | Passed |
| **Sizes that grow with zoom.** The same rectangle selects 14 dots when their diameters scale with zoom. | Passed |
| **Lasso after a pan.** A lasso around the same points after panning and zooming returns the original seven IDs. | Passed |
| **Extreme zoom.** At 1,024× zoom, rectangle selection respects the fivefold cap on dot growth in fixed-size mode. | Passed |

## Do the IDs still match on a larger scatterplot?

| Test case | Result |
| --- | --- |
| **Rectangle.** On 257 points in a 301 × 197 viewport, fractional dot sizes produce the same ordered IDs as the CPU calculation. | Passed |
| **Slanted lasso.** On the same scatterplot, a five-vertex lasso with slanted edges selects the IDs predicted by the CPU. | Passed |

## Can an old or unused point ID appear?

| Test case | Result |
| --- | --- |
| **Empty dataset.** A rectangle over an empty dataset returns no IDs after earlier queries selected points. | Passed |
| **Rectangle after replacement.** After switching to three points, only the new point at index 2 qualifies. | Passed |
| **Lasso after replacement.** A full-view lasso returns IDs 1 and 2 and skips the unused fourth slot in the WebGL texture. | Passed |
