# Small viewer comparison on M3

**Both small viewers were usable in the declared workflow. Strict color compatibility
failed; this is not full migration approval.** Production Cosmos and the acceptance
gates remain unchanged. The native inline-browser evaluation was recorded on
18 November 2026; no software adapter or separate browser substituted for it.

## Environment and timing

Production used the current workspace standalone Graph build with luma **9.3.6**,
WebGL 2 through ANGLE Metal **Apple M3**. The candidate used luma
**10.0.0-alpha.15**, Apple WebGPU / `metal-3`, `fallback: false`.
Browser user agent reported Chromium 157. Both visible panels measured
**472 × 320 CSS pixels, DPR 2** (944 × 640 attachments).

The predeclared Karate Club graph has 34 points and 78 weighted links. Each viewer
ran independently: 60 warmup ticks, Fit, 300 evolving intervals; continue to tick
5,000, Fit, then 300 **paused redraw** intervals. Actual counters matched ticks
360 and 5,000. GPU completion is included; readbacks, layout scores and pixel checks
are outside the windows. The other viewer was paused. No build or tests ran during
the timed windows. These are public host-driven viewers, not production's default
independent scheduler, and the cooled result does not measure another simulation tick.

| Viewer | Window | p95 complete interval | Within 33 ms | Gate |
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

| Frozen geometry / style | Pixels checked | Interior ID errors | Interior color errors | Invisible picks, either viewer |
|---|---:|---:|---:|---:|
| Cooled tick 5,000, A | 604,160 | 0 | 78 | 0 |
| Evolving tick 459, B | 604,160 | 0 | 707 | 0 |
| Fresh tick 0, A, final comparator | 604,160 | 0 | 88 | 0 |
| Fresh tick 0, B, final comparator | 604,160 | 0 | 469 | 0 |

Style A uses opaque six-pixel blue circles and translucent grey straight links.
Style B uses larger translucent coral circles on every third point, an invisible
point 0, and wider coral links. The fresh A/B comparisons used identical frozen
geometry. Maximum interior channel differences were **35/255 and 56/255** respectively,
above the unchanged **2/255** gate. Their cause is **not isolated**. Do not assume
these are harmless antialiasing differences or accept them as boundary pixels.

The first B comparison conservatively excluded a boundary band even around the
invisible circle. The final comparator excludes only visible circle boundaries;
the later B rejection confirms the failure without that extra exemption. The final
comparator also checks IDs against zero stored frame alpha; the first two rows
only counted IDs of zero-source-opacity points. The
cooled A comparison was unaffected. All runs retain the one-device-pixel geometric
boundary rule and exact interior IDs. Full mask agreement is not claimed at edges.

## Updates and actual running interaction

With both viewers running, A → B → A point color/size and link color/width changes
applied successfully. Public production point getters matched supplied values;
candidate GPU pixel audits had zero sampled interior ID/color errors or invisible
picks. The paired paint failures above remain separate failures of compatibility.

Native pointer input selected the same peripheral node **16** and hubs **33** and
**0** in both viewers. Dragging hub 0 visibly moved the point and its incident links
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

- **Strict compatibility: rejected in this comparison.** Interior colors differ.
  The exact successful point selections and full-attachment interior ID agreement
  do not override those failures.
- **First-slice usability: supported for this bounded small workflow.** This can
  inform an opt-in pilot decision, provided its known color differences and unsupported
  features are explicit. It does not turn the complete acceptance matrix green.
- **Full Cosmos migration: not ready.** Larger star cost, earlier latency stalls,
  full setters/styles/forces, host ownership and recovery remain open.

Use the [declared method](#/viewer-comparison?section=doc-method) and the visible
controls. Export JSON keeps local timing samples, geometry, adapters, checks and
input observations; captures are not committed. Reproduce fresh paint without a
long run by recreating the viewers, comparing A, toggling to B and comparing again.
For settled evidence, run **Assess early and cooled viewers** first. Compare paint
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
production viewer. The original geometry-derived one-device-pixel boundary was
excluded; the interior color limit remained 2/255 per channel.

| Fixture, style A | Points / links | Interior pixels | ID errors | Color errors | Max channel error | Strict paint |
|---|---:|---:|---:|---:|---:|---|
| Karate Club | 34 / 78 | 323,298 | 0 | 88 | 35/255 | Fail |
| Chain | 32 / 31 | 358,200 | 0 | 113 | 29/255 | Fail |

Both images were nonempty, with zero invisible picks in either viewer. The color
gate failed on both fixtures while exact interior IDs passed. The fixtures also
differ in positions, link density and framing, so these results do not isolate a
cause. Style B, evolved layouts, pointer interaction, timing, other devices and
full migration readiness were not assessed. The earlier color failures remain.

To repeat this bounded comparison, build the source revision above, open
**Production and WebGPU viewers**, recreate the viewers, compare style-A paint,
replace with the 32-point chain, compare again and export JSON. Use the declared
panel size and DPR for a direct comparison. The raw local capture is in
`captures/chain-paint-investigation-20261118T091319Z-89050/`. Its two paint rows
predate fixture labels: their preceding update rows and geometry lengths identify
Karate and chain. Future paint exports include the fixture and point/link counts.
