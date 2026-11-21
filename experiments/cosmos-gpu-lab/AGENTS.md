# GPU Lab research guide

The Lab records bounded research for people to understand and for agents to
reproduce. Follow the repository's root contributor guide and the Lab's
`README.md` and `src/docs/validation-workflow.md`.

## WebGPU migration tests

Every Lab test must directly help answer whether Cosmos is ready to migrate to
WebGPU. Add or extend a test only when it checks a requirement in the current
[migration scope](src/docs/validation-workflow.md) and can catch a specific
failure in the candidate or the code it uses. Assert the observable result
against the expected behavior or an independent reference. For example, render
overlapping circles and verify that picking returns the visible point's ID.

Add a separate test only for a distinct failure mode or acceptance condition.
Extend an existing test when a new fixture exercises a meaningful boundary of
the same requirement. Keep Lab navigation, report formatting, mock-only
bookkeeping, and parked experiments out of the migration suite.

## Page and demo design

- **Use one reading column.** Use `reading-document`, shared typography, and
  shared controls on experiments, the migration page, and guides at every width.
  Lead with the title, catalogue badge, and a short finding when available. Put
  the controls and live render next, then show run data, diagnostics, limits,
  and evidence.
- **Open demos paused.** Draw the starting layout with the demo's engine on
  load, including from section links. Start simulations and measurements from
  their own controls. Fit the camera once on Run or Fit, then keep it still as
  the points move.
- **Link directly to sections.** Use `#/experiment?section=<id>` and keep links
  near the relevant content. Preserve the live view, settings, and results
  when readers jump within a case. Honor query parameters on links that switch
  modes.
- **Chart results that benefit from a visual.** Give each mini chart one clear
  takeaway, direct labels, units, and the recorded conditions. Use the recorded
  values and a shared zero baseline for comparable bars. Show steps or phases
  when order matters. Use distinct labels for missing results, timeouts, and
  steps that were never reached.
- **Keep headings and copy concise.** Let the badge stand on its own. Describe
  what the check found in plain words. Add a heading when it helps readers find
  a distinct section.
- **Give each independent question its own experiment.** Use cases for
  variations on the same question. Make each experiment easy to find in the
  catalogue.
- **Use compact choice buttons.** The shared `choice-controls` style sizes
  buttons around their labels and leaves room to tap. Label each group,
  highlight the selected option, and rerun quick comparisons on click.
- **Keep reruns steady.** Give temporary progress messages a fixed place so
  the controls and renders stay in position. Check the live page at narrow and
  wide widths.

## Running studies

For an existing study, read its `agent-recipe.md` when one is present. Check the
declared workload, reference, acceptance rules, environment and output location
before running it. A test completing, a finite result and an accepted candidate
are different statements. Report missing, skipped, interrupted and unavailable
checks explicitly. Record the actual adapter; do not infer it from the browser or
from an earlier run. Keep visible-browser and timing requirements for the chosen
study, and do not run builds or tests alongside a timed measurement.

For a historical recipe that names a retired test, use the source snapshot or
revision recorded for that study. The Lab README identifies the earlier suite.

Use a unique `LAB_ARTIFACT_RUN` directory for test-produced captures. Raw
measurement JSON stays in ignored `captures/`; retain concise findings and small
reproducible fixtures in the repository. Do not silently replace earlier results
or infer an unrecorded source revision.

For a result that another agent should reproduce, use a clean committed revision
or retain an exact source snapshot including the needed staged, unstaged and new
files. Record the snapshot location and the actual browser, adapter, inputs and
dependencies. A revision plus a list of modified filenames is not a snapshot.
Treat a run without identifiable source as provisional. Rebuild generated controls
from that source before measuring, and do not build during a timed window.

For a new investigation, state the question, reference, inputs, boundaries and
applicable acceptance rules before interpreting the result. Retain meaningful
failures and controls, distinguish observations from hypotheses, and report what
was not tested. New local evidence does not erase a historical failure or approve
the full migration. The validation workflow describes the existing numerical and
performance policies.

The live views and `recorded-summary.json` files for `viewer-comparison`,
`precision-diagnostics` and `pilot-viewer` are a prototype. Their small records summarize named
historical findings; they do not substitute for their source documents or raw
captures. Their recipes describe focused replays and explicitly name what remains
outside those replays.
