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
interior ID and invisible-picking checks.

## Edge-smoothing control

A separate replay enabled a one-device-pixel link-coverage ramp in the
experimental renderer. It removed about 96–97% of the over-tolerance differences
in the excluded edge region. All 557 interior failures remained unchanged.

## Short-link opacity

The first failure in each style came from the link from point 3 to point 7.
It measured 19.15 CSS pixels. Production's visibility rule uses
`max(1, (150 - length) / 100)` in the production graph. At that length the rule boosts
the configured opacity by 1.309×. That multiplier predicted the exact isolated
RGBA in the production renderer. The candidate originally used the configured
link opacity directly.

| Style | Device pixel | Production alpha | Original candidate alpha | Candidate with distance rule |
| --- | --- | ---: | ---: | ---: |
| A | (1020, 100) | 150 | 115 | 150 |
| B | (1021, 99) | 234 | 178 | 234 |

Changing the production near-distance threshold to zero in the isolated probe
gave the original candidate's exact RGBA in both styles. Applying production's
distance rule in the candidate matched the original production RGBA.

The native A/B replay compared 1,228,800 pixels per style. The original controls
retained 88 and 469 interior failures. The distance-opacity candidate matched
every interior RGBA byte in both styles, with either edge treatment. Exact
interior IDs and invisible picks also passed. Combining distance opacity and
the ramp left 172 and 158 over-tolerance pixels in the excluded boundary region.

The result covers the frozen Karate Club styles and camera on Apple M3 native
Chrome 157. The [graph comparison findings](#/viewer-comparison?section=doc-findings-short-link-opacity)
include the source snapshot and production control checksum.
