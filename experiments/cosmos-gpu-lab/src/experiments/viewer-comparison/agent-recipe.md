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
