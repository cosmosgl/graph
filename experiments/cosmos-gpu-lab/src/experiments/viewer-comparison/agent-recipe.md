# Agent recipe: compare viewer colors on the same geometry

## Question and scope

Do the production WebGL and experimental WebGPU viewers paint the same frozen
graph? This focused recipe checks styles A and B on fresh Karate Club geometry.
It does not reproduce the 5,000-tick assessment, frame timings, actual pointer
interaction, layout quality or the full migration decision.

## Prepare

For a result intended for later reproduction, use a clean committed revision or
retain an exact source snapshot including the required staged, unstaged and new
files. Record its location. A filename list does not preserve their contents;
without identifiable source, the result is provisional. Record the dependencies,
actual browser and devices as well as the revision.
The Lab README's **Recording reproducible source** section gives snapshot steps.

From the repository root, build the production control from that source, then start the lab:

```sh
pnpm run build
pnpm --filter @cosmos.gl/gpu-lab dev
```

Open `#/viewer-comparison?section=run-run` at the local URL in a visible browser
with native WebGL 2 and WebGPU. Wait for both viewers to initialize. Confirm both
canvas panels are nonempty and record the actual reported devices, browser,
viewport and device pixel ratio. If either backend is unavailable, report the
result as incomplete; do not substitute another adapter silently.

## Run the focused comparison

1. Choose **Destroy and recreate** to restore the fresh Karate Club graph and
   style A. The graph has 34 points and 78 weighted links.
2. Choose **Compare same-geometry paint**. Wait for its result in **Live results**.
   This copies the candidate geometry and camera to the production viewer.
3. Choose **Toggle style A / B**, then **Compare same-geometry paint** again.
   Wait for the style-B result. Keep the original colors and acceptance rules.
4. Choose **Export JSON**. Create a new, uniquely named directory inside
   `experiments/cosmos-gpu-lab/captures/`. Save the download there; if the browser
   saves to its default Downloads folder, copy the actual downloaded file into
   the new directory. Do not replace an earlier capture.
5. In that directory, save a `run-context.txt` or `run-context.json` with the
   time, capture path, `git rev-parse HEAD`, the output of `git status --short`
   (or explicitly say it is clean), and the scope of the checks actually run.
   The browser export does not include the revision or working-copy state.

The original comparison allows a one-device-pixel geometric boundary. Away from
that boundary, IDs must match, no invisible source may be picked, and each color
channel may differ by at most 2/255. Read the named ID, color and visibility
counts in each row. A color failure remains a failure even when IDs match.
Compare the historical counts only with their recorded viewport and environment;
different devices and sizes are new observations, not identical reruns.

The export's `protocol` describes the full available assessment, not a list of
completed steps. Use the `records` and feedback entries to identify what actually
ran. A fresh A/B paint replay has no frame-time or pointer-interaction assessment.

For the complete historical procedure—including the cooled run, actual pointer
interactions and timing—follow **Viewer comparison protocol**. It requires the
visible native browser, the declared panel dimensions and no competing build or
test process during timing. Keep these focused paint checks distinct from it.

## Final account

Report the actual devices, browser, viewport, revision, working-copy state,
source snapshot location if needed, and capture path. Say whether the source is
reproducible or provisional. For styles A and B give pixels checked, interior ID/color errors,
invisible picks and the result of the original gates. Name missing or unavailable
checks. State explicitly that this short recipe does not establish frame-time,
interaction, cooled-layout or full-migration acceptance. Preserve earlier
failures even if a later local run differs.

## Investigate a new question

Before changing the workload, visual treatment or acceptance rules, state the
new question, inputs, reference and agreed gates. Save a separate capture and
explain how it differs from this focused replay. Follow the Lab's
[validation workflow](#/validation-workflow) and
`experiments/cosmos-gpu-lab/AGENTS.md`; retain negative and incomplete results.

## Find where an interior color error appears

Plan declared on 19 November 2026. Use fresh Karate Club positions at tick zero
with native WebGL and WebGPU. Use one displayed viewport, equal panels and a
fixed DPR. Run styles A and B with the usual full draw first. Keep the same
geometry, camera and style for the layer checks. The original one-device-pixel
boundary, exact IDs, invisible-pick check and 2/255 interior color tolerance
apply to the full draw.

For each style, choose **Compare same-geometry paint**, then **Attribute paint
differences**. The second action repeats the full draw and records isolated
point and link color attachments. Check that the two full results agree before
interpreting the layer counts. Every full interior color failure belongs to one
of four groups:

- **Points** exceeds 2/255 with points alone.
- **Links** exceeds 2/255 with links alone.
- **Both** exceeds 2/255 in each isolated layer.
- **Composed** exceeds 2/255 when both layers are drawn together and stays
  within tolerance in each isolated layer.

The point and link counts exclude pixels in the both group. Each populated
group retains one coordinate and the paired RGBA bytes from the full, point
and link draws. These controls localize the differences on the frozen inputs.
Shader attribution and viewer parity require further evidence.
Export JSON once after both styles. Save the exact source, generated production
control checksum, actual adapters, browser, viewport and DPR with the capture.

## Compare straight-link edge smoothing

Run **Attribute paint differences** and then **Test link edge smoothing** on
fresh Karate Club at style A. Toggle to style B and repeat. Keep the same camera
and frozen position buffer in each pair. Use 960 × 320 CSS panels at DPR 2 on
visible native Chrome on the M3. The optional WebGPU paint pass applies the
blended straight-link study's one-device-pixel coverage ramp and scales opacity
for widths below one device pixel. Both A and B exercise the coverage ramp.

The unchanged comparator excludes a one-device-pixel geometric boundary and
requires exact interior point IDs, no invisible picks, and interior RGBA within
2/255 per channel. Compare the excluded edge color count separately. That count
diagnoses the width ramp. The earlier interior failures could persist because
the ramp lies inside the excluded boundary. Keep the production color gate
open unless the original interior criteria pass, and preserve earlier evidence.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_PAINT_LINK_SMOOTHING=1 LAB_ARTIFACT_RUN=viewer-link-smoothing-20261119-r1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/viewer-comparison/paint-layers.test.ts
```

## Check the short-link opacity rule

Use **Compare corrected link paint** under **Additional checks** to run the
candidate with both distance opacity and smoothing on the current frozen
positions. To replay the recorded four comparisons, use the test below.

Replay the same native M3 viewport, fresh Karate Club positions, camera and
styles. Keep the original 2/255 interior color gate, boundary, exact IDs and
invisible-pick check. Save four comparisons per style using constant opacity
or the production distance rule, each with the original hard edge or the
separate smoothing ramp.

At each saved link witness, render edge 32 by itself with the production
renderer and the candidate. Keep the endpoints, width and source RGBA fixed.
In a separate diagnostic, set the WebGL near threshold to zero, which holds
opacity at the source value. Restore the original threshold before replaying
the full scene. Predict the isolated RGBA from each renderer's endpoint
coordinates, camera zoom and source color. Record the measured attachment bytes
and the CPU prediction together. An accepted result covers the frozen styles
at this camera and environment.

Use the source snapshot variables above and rebuild the UMD production
control before the run. Record its checksum in the capture.

```sh
VITE_LAB_PRODUCTION_SHA256=$(shasum -a 256 dist/index.min.js | cut -d' ' -f1)
export LAB_NATIVE_VISIBLE=1 VITE_LAB_PAINT_LINK_OPACITY=1 VITE_LAB_PRODUCTION_SHA256
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/viewer-comparison/paint-link-opacity.test.ts
```
