The two frames each load a standalone Cosmos package, verify which device the Graph created, and run the same application. Each Graph receives fresh typed arrays for positions, shapes and sizes. The camera stays at zoom 1, simulation is off, and each point has an opaque blue fill on the same charcoal background.

Each shape occupies one column. With a CSS pixel offset, the first row uses a 22 CSS pixel diameter and integer centers. The second changes only diameter, the third changes only position, and the fourth combines both changes. The two fractional center choices move points right and down by (0.25, 0.375) or (0.1, 0.4) CSS pixels.

The diameter control applies the same fractional diameter to all eight shapes. Its four presets are 22.125, 22.3, 22.625 and 22.75 CSS pixels. Each remains fractional in device pixels at both ratios.

The rounding-tie placement puts all 32 centers at odd multiples of 1/32 of a device pixel. Each axis lies exactly halfway between two neighboring 1/16-pixel grid lines before projection. The offsets vary by row and shape and are divided by the pixel ratio to exercise these ties at both resolutions. All four rows use the selected fractional diameter. The additional **24 / 22 control** alternates 24 and 22 CSS pixels by row to reproduce the original SwiftShader scene at 1×.

Each Graph redraws into its own canvas immediately before capture. The Lab compares all RGBA bytes at native resolution, including the antialiased edges. A pixel counts once if any channel differs. The counts for the 32 cells add up to the full-frame count. Highlighting paints those locations on a separate overlay.

Both views occupy 264 × 152 CSS pixels. At pixel ratio 2, each drawing buffer is 528 × 304 device pixels.

## How the renderer matches edge pixels

On the M3, recording the floating-point coordinates inside native point sprites revealed a 32-device-pixel tile pattern. Moving one sprite edge could change coordinates along the other axis. The WebGPU shader models this by computing a slope from the sprite area in the vertex stage. In the fragment stage it sets the coordinate at the tile corner and evaluates the slope at the pixel center, rounding toward zero. It then applies the same vertical orientation as ANGLE.

The precision settings are an empirical fit to those coordinate samples. The model carries a 25-bit reciprocal of the area, rounds the slope upward at 29 bits, and rounds the tile constant at 29 and then 28 bits before storing it as a 32-bit float. The Lab tests the resulting RGBA values independently. Additional sizes and offsets outside the presets are reported on the results page.

On SwiftShader, pixel coverage and the coordinates used to shade the pixel depend on separate rounding operations. The WebGPU shader projects the center and corners with the Graph camera, rounds them independently on the 1/16-device-pixel grid and uses the requested diameter to calculate the shape coordinate. The tie preset exercises both directions of rounding.
