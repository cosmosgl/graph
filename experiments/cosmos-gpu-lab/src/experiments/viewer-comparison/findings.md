# Small-graph comparison on M3

**Both backends supported small-graph exploration on 18 November. That run failed its
color gate. A later native replay matched both frozen styles with the short-link
opacity rule.** The workflow evaluation used the native inline browser.

## Environment and timing

Production used the current workspace standalone Graph build with luma **9.3.6**,
WebGL 2 through ANGLE Metal **Apple M3**. The candidate used luma
**10.0.0-alpha.15**, Apple WebGPU / `metal-3`, `fallback: false`.
Browser user agent reported Chromium 157. Both visible panels measured
**472 × 320 CSS pixels, DPR 2** (944 × 640 attachments).

The predeclared Karate Club graph has 34 points and 78 weighted links. Each backend
ran independently: 60 warmup ticks, Fit, 300 evolving intervals; continue to tick
5,000, Fit, then 300 **paused redraw** intervals. Actual counters matched ticks
360 and 5,000. GPU completion is included; readbacks, layout scores and pixel checks
are outside the windows. The other graph was paused. No build or tests ran during
the timed windows. The comparison used public host-driven frames. The cooled window
measured paused redraws.

| Backend | Window | p95 complete interval | Within 33 ms | Gate |
|---|---|---:|---:|---|
| Production WebGL | Evolving, ticks 61–360 | 16.8 ms | 300/300 | Pass |
| luma WebGPU | Evolving, ticks 61–360 | 17.4 ms | 300/300 | Pass |
| Production WebGL | Cooled, paused redraw | 17.5 ms | 300/300 | Pass |
| luma WebGPU | Cooled, paused redraw | 17.7 ms | 300/300 | Pass |

These display-paced intervals do not establish a GPU speed ratio. The unchanged
requirement is at least 95% within 33 ms.

## Appearance and exact picking attachments

After Fit, both settled views showed similar two-hub structure and peripheral
branches. All 34 candidate points were inside the view. Link crossings still make
individual edges harder to follow. Graph-distance stress was 0.317028 / 0.317026
(WebGL / WebGPU) at tick 360 and 0.280488 / 0.280456 at tick 5,000. These are quality
observations, not an invented stress acceptance threshold or proof of identical trajectories.

The candidate's sampled CPU audit at tick 5,000 checked 2,150 pixels: zero interior
ID/color errors and zero invisible picks. A separate full-attachment comparison put
the **same candidate positions and camera** into the unchanged production renderer:

| Frozen geometry / style | Pixels checked | Interior ID errors | Interior color errors | Invisible picks across both panels |
|---|---:|---:|---:|---:|
| Cooled tick 5,000, A | 604,160 | 0 | 78 | 0 |
| Evolving tick 459, B | 604,160 | 0 | 707 | 0 |
| Fresh tick 0, A, final comparator | 604,160 | 0 | 88 | 0 |
| Fresh tick 0, B, final comparator | 604,160 | 0 | 469 | 0 |

Style A uses opaque six-pixel blue circles and translucent grey straight links.
Style B uses larger translucent coral circles on every third point, an invisible
point 0, and wider coral links. The fresh A/B comparisons used identical frozen
geometry. Maximum interior channel differences in that run were **35/255 and
56/255**, above the unchanged **2/255** gate. The short-link opacity study below
replays the fresh styles and identifies their cause.

The first B comparison conservatively excluded a boundary band even around the
invisible circle. The final comparator excludes only visible circle boundaries;
the later B rejection confirms the failure without that extra exemption. The final
comparator also checks IDs against zero stored frame alpha; the first two rows
only counted IDs of zero-source-opacity points. The
cooled A comparison was unaffected. All runs retain the one-device-pixel geometric
boundary rule and exact interior IDs. Full mask agreement is not claimed at edges.

## Updates and actual running interaction

With both graphs running, A → B → A point color/size and link color/width changes
applied successfully. Public production point getters matched supplied values;
candidate GPU pixel audits had zero sampled interior ID/color errors or invisible
picks. The paired paint failures above remain separate failures of compatibility.

Clicks registered the same IDs in both panels for peripheral point **16** and
hubs **33** and **0**. Dragging hub 0 visibly moved the point and its incident links
while simulation continued (around ticks 4,300). Several earlier clicks landed on
background after the small moving point left the screenshot location; those null
results remain in the capture, not counted as exact-node successes.

| Observation | Measured scope | Feedback proxy |
|---|---|---|
| Production point clicks | IDs 16, 33, 0 | 22.0–31.6 ms |
| Candidate successful point picks | IDs 16, 33, 0, then 0 for drag start | 7.7–22.4 ms |
| Production drag callbacks | Eight movement callbacks | 19.3–29.3 ms |
| Background/missed moving-target inputs | One production background callback, four candidate null picks | 32.8 ms production; 8.4–11.8 ms candidate |

Every captured input feedback value was within the unchanged 50-ms target.
Production begins timing at its click or drag event; candidate picking starts at
pointerdown. Completion plus the next animation opportunity is a browser-visible
feedback proxy, not measured physical scanout. Production explicitly submits an
event-driven host frame and can advance an extra tick. These paths do not support
a direct speed ratio. Candidate drag-move latency was not separately instrumented;
its movement was visually checked. The previous 68.2-ms integrated picking outlier
remains unresolved and is not erased by this run.

Running replacement with a 32-point chain and restoration of Karate Club preserved
finite positions, expected counts/styles and passing candidate pixel audits.
Height changes 320 → 280 → 320 reached identical 944 × 560 and 944 × 640 attachments.
The first harness read too soon: production still exposed its previous size after
one animation opportunity. Waiting for its actual ResizeObserver result took two
opportunities in each replay; both settled checks passed. Resize is outside timing.
Pause/resume and destroy/recreate worked; double destruction was harmless and the
old production canvas detached. Extra native empty-space drag and wheel checks
visibly moved and zoomed both cameras; equal wheel gain was not asserted.

## Decision and reproduction

- **Strict compatibility: rejected in this comparison.** Interior color differences
  exceeded the limit. Clicked point IDs and interior pixel IDs matched.
- **First-slice usability: supported for this bounded small workflow.** This can
  inform an opt-in pilot decision, provided its known color differences and unsupported
  features are explicit. It does not turn the complete acceptance matrix green.
- **Full Cosmos migration: not ready.** Larger star cost, earlier latency stalls,
  full setters/styles/forces, host ownership and recovery remain open.

Use the [declared method](#/viewer-comparison?section=doc-method) and the visible
controls. Export JSON keeps local timing samples, geometry, adapters, checks and
input observations; captures are not committed. Reproduce fresh paint without a
long run by recreating the graphs, comparing A, toggling to B and comparing again.
For the running and paused redraw measurements, choose **Measure frame times**. Compare paint
intentionally replaces the production layout; reset before another independent run.

Seven focused tests passed in the same inline browser: four report/gate regressions
and three existing integrated rendering/interaction regressions. Three unrelated
profiling cases were deliberately unselected. Lab typecheck, luma API boundary
check, targeted lint and build passed. No production file or dependency changed.

The next decision is the explicit supported first-slice envelope, not an open-ended
raster investigation. Preserve these color failures; isolate them before claiming
production color compatibility, or sooner if they visibly obstruct the intended pilot.

## Follow-up: style-A paint on a small chain

On 18 November 2026, a focused follow-up asked whether the same strict color failure
also appears on a different small graph. The clean source revision was
`5a5bdbc3ca2355d90b19022841d72529d645b9e4`. In a visible native Chromium 157 session,
production WebGL reported Apple M3 through ANGLE Metal and the candidate reported
Apple WebGPU / `metal-3`, `fallback: false`. The luma versions were 9.3.6 and
10.0.0-alpha.15 respectively. This is separate from the earlier timed assessment.

Both panels measured 305 × 320 CSS pixels at DPR 2 (610 × 640 attachments). For
each fresh fitted fixture, candidate positions and camera were copied into the
production graph. The original geometry-derived one-device-pixel boundary was
excluded; the interior color limit remained 2/255 per channel.

| Fixture, style A | Points / links | Interior pixels | ID errors | Color errors | Max channel error | Strict paint |
|---|---:|---:|---:|---:|---:|---|
| Karate Club | 34 / 78 | 323,298 | 0 | 88 | 35/255 | Fail |
| Chain | 32 / 31 | 358,200 | 0 | 113 | 29/255 | Fail |

Both images were nonempty, with zero invisible picks in either panel. The color
gate failed on both fixtures while exact interior IDs passed. The fixtures also
differ in positions, link density and framing, so these results do not isolate a
cause. Style B, evolved layouts, pointer interaction, timing, other devices and
full migration readiness were not assessed. The earlier color failures remain.

To repeat this bounded comparison, build the source revision above, open
`#/viewer-comparison`, recreate the graphs, compare style-A paint,
replace with the 32-point chain, compare again and export JSON. Use the declared
panel size and DPR for a direct comparison. The raw local capture is in
`captures/chain-paint-investigation-20261118T091319Z-89050/`. Its two paint rows
predate fixture labels: their preceding update rows and geometry lengths identify
Karate and chain. Future paint exports include the fixture and point/link counts.

## Link layer attribution

A 19 November 2026 native Chrome 157 check on Apple M3 reproduced both strict
interior color failures and isolated every failing pixel to the link draw. The
production graph used WebGL 2 through ANGLE Metal with luma 9.3.6. The candidate
used Apple WebGPU (`metal-3`, `fallback: false`) with luma 10.0.0-alpha.15.

The fresh 34-point, 78-link Karate Club fixture stayed at tick zero. Both panels
were 960 × 320 CSS pixels at DPR 2, with 1920 × 640 attachments. For each style
the control compared both layers with the original one-device-pixel boundary and
2/255 interior RGBA tolerance. The replay held the geometry and camera fixed and
matched the control's full result before measuring points-only and links-only.

| Style | Boundary pixels | Interior color failures | Maximum error | Link-only failures among these pixels |
|---|---:|---:|---:|---:|
| A | 67,102 | 88 | 35/255 | 88 |
| B | 68,177 | 469 | 56/255 | 469 |

Both styles passed the original exact interior IDs and invisible-pick checks.
Each of the 557 failing pixels stayed within tolerance with only the points
drawn. For example, at device pixel (1021, 99) in style B, both the full and
links-only images read RGBA `[217, 96, 83, 234]` in production and
`[166, 74, 64, 178]` in WebGPU. The points-only images read transparent black
there. This located the discrepancy in the link draw. The short-link opacity
study below compares the isolated production and candidate draws at that pixel.

Use **Attribute paint differences** beside **Compare same-geometry paint** to
repeat the controls. The [agent recipe](#/viewer-comparison?section=doc-agent-recipe)
describes the check. A focused native browser regression passed for the control
equivalence and layer attribution. On the frozen source, after building the
production UMD, run it with:

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_PAINT_LAYERS=1 LAB_ARTIFACT_RUN=paint-layers-20261119-r1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/viewer-comparison/paint-layers.test.ts
```

The local capture, witnesses, analysis and frozen source are in
`captures/paint-layers-20261119-i59nfoxp/`. The source archive SHA-256 is
`f6fe23f4eba9b570ba8774e5a2bbad7b59984527203cbb5c4226cc0ebf77c42e`.

## Straight-link edge smoothing

One visible Chrome 157 replay on 19 November 2026 compared the original
WebGPU links with the opt-in one-device-pixel coverage ramp used by the
production straight-link shader. The same M3, native adapters, 960 × 320
CSS panels, DPR 2 and frozen Karate Club camera and positions were used.
Each style compared 1,228,800 pixels at an unchanged 2/255 color tolerance.

| Style | Excluded edge differences, hard → smoothed | Interior differences, hard → smoothed | Maximum interior error |
|---|---:|---:|---:|
| A | 30,265 → 832 | 88 → 88 | 35/255 |
| B | 29,125 → 1,083 | 469 → 469 | 56/255 |

Smoothing removed about 96–97% of over-tolerance edge differences. Those
pixels are outside the original interior gate. All 557 interior failures
persisted in the isolated link draws, with the same first witnesses. Exact
interior IDs and invisible-pick checks passed throughout. The smoothing-only
control failed the original production interior color gate.

**Test link edge smoothing** uses that shader only for the diagnostic
capture. The normal display and its original paint control still use the
default shader. The [agent recipe](#/viewer-comparison?section=doc-agent-recipe-compare-straight-link-edge-smoothing)
repeats the paired check. The focused native test passed for equal geometry,
camera and geometric boundary and exercised the candidate on both styles.
Raw results, the declared protocol and the source archive are in
`captures/viewer-link-smoothing-20261119-k36ve6q1/`. The source archive
SHA-256 is `83aabf23fe67a88e171d39f54c37ec93be95cd5b2e964b6ce9c33457c6430787`.

## Short-link opacity

On the same frozen Karate Club scene, both A/B witnesses intersected link 32
(point 3 to point 7). It projected to 19.15 CSS pixels. Production evaluates
`max(1, (150 - length) / 100)` with the production graph's configured limits and raises
the source opacity by about 1.309×. The CPU calculation from the actual
positions, camera and source color predicted the isolated RGBA bytes exactly.

| Style | Device pixel | Production RGBA | Constant-opacity candidate | Candidate with distance rule |
|---|---|---|---|---|
| A | (1020, 100) | 75, 81, 90, 150 | 57, 62, 68, 115 | 75, 81, 90, 150 |
| B | (1021, 99) | 217, 96, 83, 234 | 166, 74, 64, 178 | 217, 96, 83, 234 |

The production probe made the other links transparent through its public color
channel. The WebGPU probe rendered the same single instance. A separate WebGL
probe set the near threshold to zero, matched the original candidate bytes and
restored the threshold before the full replay. The WebGPU candidate uses length
in CSS pixels and applies distance opacity before coverage in both edge modes.

| Style | Original | Smoothing only | Distance opacity only | Distance opacity and smoothing |
|---|---:|---:|---:|---:|
| A interior color failures | 88 | 88 | 0 | 0 |
| B interior color failures | 469 | 469 | 0 | 0 |
| A excluded edge failures | 30,265 | 823 | 29,998 | 172 |
| B excluded edge failures | 29,126 | 1,082 | 28,709 | 158 |

The full captures used 960 × 320 CSS panels at DPR 2 and checked 1,228,800
pixels per style. Every interior channel matched exactly with distance opacity.
The replay required exact interior IDs, zero invisible picks and a 2/255
interior color tolerance. The production control used luma 9.3.6 on Apple M3
ANGLE Metal WebGL 2.
The candidate used luma 10.0.0-alpha.15 on non-fallback Apple Metal 3 WebGPU.
Chrome `157.0.8103.79` was visible. The focused replay and graph interaction regressions
passed 4/4 from the isolated source archive. The evaluated scope is two fresh
styles at one camera on M3. Moving and cooled positions, corrected frame cost,
other link styles and other adapters still need their own comparisons.

**Compare corrected link paint** under **Additional checks** uses the two
corrections in the paired snapshots and reports the result in Live results.
The native graph comparison and report tests passed 5/5 with this action and the same
production UMD checksum.

The recorded bytes, four paint comparisons, original controls and generated UMD
are in `captures/viewer-link-opacity-m3-20261119.iazxmC/`, built from a frozen
copy of the source archive at base `5a211b93`. The archive SHA-256 is
`5fe2855417c8ab65a0907959274d39cff9350acc610361358fd17b51a819fdd4`.
The production UMD SHA-256 is
`1e5d4c779f33c2a510a0d3c9ee43dbf7f0d0cb6e99a728d1ca0bee98130cd4dc`.
[Replay method](#/viewer-comparison?section=doc-agent-recipe-check-the-short-link-opacity-rule)
