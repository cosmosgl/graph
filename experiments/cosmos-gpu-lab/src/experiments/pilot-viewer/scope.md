# First pilot: a small graph explorer

**Proceed with a research-only Karate Club viewer inside the lab. Do not replace
production Cosmos or claim that the first migration is accepted.** The purpose is
to find out whether the integrated backend supports a useful exploration task:
locate a member, inspect their connections, and move the graph while it runs.

The representative input is selected **before evaluation**: the existing Zachary
Karate Club dataset, 34 members and 78 weighted undirected links. Member IDs 0–33
are dataset indices, not real names. The [dataset source and attribution](#/integrated-webgpu?section=doc-method)
remain with the original integrated experiment. No new fixture, force or shader is introduced.

## Supported trial scope

| Area | Available in this pilot | Boundary |
|---|---|---|
| Simulation | Existing corrected resident repulsion, weighted springs, gravity, center and cooling | Same default arithmetic and force parameters as the integrated experiment; no new tolerance |
| Drawing | Opaque circles; solid straight links; original shared GPU positions | Fixed screen-space sizes; default palette; degree sizes `6 + degree / 3` CSS pixels |
| Exploration | GPU point picking and dragging; pan/zoom; explicit Fit; member lookup and neighbor inspector | Lookup/neighbor buttons use known IDs; they are not picking evidence. Labels are ordinary page text |
| Updates | Change point sizes; reset/reload the selected graph; pause/resume | This does not implement the complete Graph setters or arbitrary graph ingestion |
| Lifecycle | Existing runtime resize/destruction; disposable lab page | No shared host device, deck integration, recovery or production ownership policy |
| Environment | Current user's native Apple M3 in the visible inline browser | No device/browser portability claim |
| Workload | This 34-member real graph | Earlier synthetic 1,024 and 8,192 results are context, not approval of those sizes in this viewer |

Point and link colors remain those of the integrated runtime. Size-by-degree changes
only drawing, not force parameters or link weights. Selection highlights the picked
member; the inspector computes neighbors and total connection weight from the original
CPU topology. That metadata is not a GPU simulation readback.

## Blockers and stopped investigations

| Issue | Current decision | Reopen when |
|---|---|---|
| Production interior colors differ | **Strict compatibility rejected.** Retain the [matched viewer findings](#/viewer-comparison?section=doc-findings); the two-byte gate is unchanged | Before claiming production color compatibility, or immediately if the intended exploration is visually obstructed |
| Earlier 68.2-ms pick and intermittent stalls | Unresolved; this trial now records a 100.4-ms running pick | **Reopened:** attribute the recorded delay before accepting responsiveness; see findings |
| 8,192-point star cost | Outside this viewer's supported trial; tuning stopped for the first attempt | A representative pilot actually requires a large hub workload |
| Faint nonzero opacity, advanced raster boundaries and exact arithmetic refinements | Prior rejected cases stay rejected; deeper investigation parked | The pilot needs the option, or before full migration approval |
| Full feature/API/host coverage | Not implemented or not accepted here | A deliberate next integration task with its own control and evidence |

Explicitly unsupported: collisions, mouse repulsion, clusters, attractors, curved or
patterned links, arrows, link picking, point images/rings, transitions, automatic fit,
text rendering in the GPU canvas, host-device sharing, recovery, and nonzero opacity
below 0.02. The current pilot exposes opaque points only. There is no hidden WebGL
fallback and no production backend switch.

**The decision to try the viewer is not permission to relabel a failed gate.** Strict
compatibility, first-slice usability and full migration readiness remain separate.
A functional trial can continue while the documented compatibility blocker stays red.
If a local responsiveness, identity or visibility check fails, retain that failure
and investigate before claiming this workflow passed. A known color mismatch is
not excused as a boundary pixel without geometry evidence.

## Declared evaluation

Use the visible native inline browser, verify the actual adapter and a nonempty
canvas first. The rendering workload uses the available CSS width at a 16:9 aspect ratio,
captured on page load at the recorded DPR; export records both attachment and
displayed CSS dimensions. Keep the window size fixed during evaluation. Reload
after changing the browser width to recapture its rendering size. Seed 29471; 5,000-tick cooling;
gravity 0.25, center 0.1, repulsion 1, friction 0.85, spring 1, spring distance 10 and
fixed distance variation. Default ordered `hoist` springs and corrected arithmetic
remain unchanged.

1. Reset to the 34-member graph and uniform six-pixel circles. Advance 60 warmup
   ticks, Fit, then measure 300 evolving complete frame intervals with one GPU
   completion in flight. No builds, tests or validation readbacks in this window.
   UI status and inspector refresh remain part of the application workload.
2. Outside frame timing, use the existing integrated interaction sequence: 20 paused
   picks; 20 running picks on a temporary pinned, last-drawn target; 20 drag moves;
   camera inverse/zoom checks; pause/resume and resize. Preserve its exact ID and
   pin checks. The stable target is a controlled diagnostic, not ordinary exploration.
3. Run the existing sampled CPU color/ID audit outside timing. It retains the
   one-device-pixel geometric boundary and two-byte interior channel rules. Existing
   thin-link regressions remain relevant; a sampled audit does not prove full masks.
4. Use actual pointer input: select a visible member, drag while running, locate
   member 0, follow a neighbor button, change degree sizes, pan/zoom, pause/resume
   and reset. Check inspector identity/metadata against the dataset. Lookup actions
   remain distinct from GPU picks. Record native feedback separately from the
   automated request range in the capture.
5. Export locally; report successful behavior, remaining unchecked scope and all
   failures. Previously reviewed cooled readability is [prior evidence](#/viewer-comparison?section=doc-findings),
   not a new cooled-window claim in this trial.

Gates stay **at least 95% of complete frame intervals within 33 ms**, picking/recorded
drag feedback **within 50 ms**, exact identities and no invisible-source interception.
GPU completion plus the next animation opportunity is a feedback proxy, not physical
scanout. The DOM inspector has its own 100-ms refresh; its latency is not included
in the GPU highlight measurement. Native drag-move latency is not separately
instrumented; the controlled drag sequence measures it. Layout scores without an
agreed quality budget are observations, not pass/fail gates.

## Reproduce

Build the workspace control if needed, then run the lab:

```sh
pnpm run build
pnpm --filter @cosmos.gl/gpu-lab dev
```

Open `#/pilot-viewer`. Use **Assess this pilot** for the declared controlled window,
then **Run** for native exploration. **Check current pixels** audits the current
selection/size/camera state. **Export JSON** retains local raw evidence; no measurement
JSON or ZIP is committed. Cancelled assessments do not yield a passing row, and
previous completed records remain visible. Reset changes the live graph, not the
recorded verdicts.
