---
source: Recorded findings
recorded: 2026-11-12
device: Apple M3; Chrome 157; luma.gl 10.0.0-alpha.4
scope: Frozen point shapes, overlaps and defaults at selected zooms and pixel ratios
---

# Point-shape evidence

The comparison draws the same shapes in production WebGL and the WebGPU port.
An independent CPU shape mask supplies a geometric reference. The recorded
pixel gate requires exact IDs and masks, no invisible picks, and color channels
within 2/255.

On 12 November 2026, all 12 selected M3 configurations passed: five shape and
stroke settings, four overlap settings, and three default/edge-case settings.
The default inline images were byte-identical across the two GPU targets. These
are frozen images, not a complete Graph or cross-device validation.

## Fractional positions and sizes

A separate fixture used diameters from 0.25 to 42.5 CSS pixels and quarter-pixel
coordinates. Both recorded rows failed the original parity contract:

| Pixel ratio | WebGL/WebGPU ID differences | CPU mask failures, WebGL / WebGPU | Color pixels beyond 2/255 |
| ---: | ---: | ---: | ---: |
| 1 | 2 | 2 / 0 | 27 |
| 2 | 0 | 6 / 6 | 46 |

Neither row had invisible picks. These failures are separate from the 12 passing
configurations; a regression test completing does not approve the fractional
fixture. The result does not establish a driver defect or behavior on other GPUs.
