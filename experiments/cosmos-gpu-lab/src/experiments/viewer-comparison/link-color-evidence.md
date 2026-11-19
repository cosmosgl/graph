# Link-color evidence

On 19 November 2026, a native Chrome 157 comparison on Apple M3 held the same
Karate Club positions and camera fixed in the production WebGL and experimental
WebGPU renderers. The graph had 34 points and 78 links. Each panel was 960 × 320
CSS pixels at DPR 2.

## Isolating the difference

The comparison used the existing interior RGBA tolerance of 2/255 and excluded a
one-device-pixel geometric boundary. Drawing links and points separately located
all recorded interior color failures in the link draw.

| Style | Interior failures | Maximum color-channel error | Link-only failures |
| --- | ---: | ---: | ---: |
| A | 88 | 35/255 | 88 |
| B | 469 | 56/255 | 469 |

Point-only draws stayed within tolerance at those pixels. Both styles passed the
interior ID and invisible-picking checks. The observation identifies the affected
layer, but does not establish the underlying mechanism.

## Edge-smoothing control

A separate replay enabled a one-device-pixel link-coverage ramp in the
experimental renderer. It removed about 96–97% of the over-tolerance differences
in the excluded edge region. All 557 interior failures remained unchanged.

These observations cover two styles and one device. The remaining interior color
failure is unresolved; this is not a complete visual-compatibility assessment.
