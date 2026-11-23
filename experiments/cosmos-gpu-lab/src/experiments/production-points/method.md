The two frames each load a standalone Cosmos package, verify which device the Graph created, and run the same application. Each Graph receives fresh typed arrays for positions, shapes and sizes. The camera stays at zoom 1, simulation is off, and each point has an opaque blue fill on the same charcoal background.

Each shape occupies one column. The first row uses a 22 CSS pixel diameter and integer centers. The second changes only diameter, the third changes only position, and the fourth combines both changes. A fractional position moves the center 0.25 CSS pixels right and 0.375 down. Both coordinates remain fractional at pixel ratios 1 and 2.

The diameter control applies the same fractional diameter to all eight shapes. Its four presets are 22.125, 22.3, 22.625 and 22.75 CSS pixels. Each remains fractional in device pixels at both ratios.

Each Graph redraws into its own canvas immediately before capture. The Lab compares all RGBA bytes at native resolution, including the antialiased edges. A pixel counts once if any channel differs. The counts for the 32 cells add up to the full-frame count. Highlighting paints those locations on a separate overlay.

Both views occupy 264 × 152 CSS pixels. At pixel ratio 2, each drawing buffer is 528 × 304 device pixels. The same scene is drawn at both resolutions.
