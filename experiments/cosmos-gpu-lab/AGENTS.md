# GPU Lab research guide

The Lab records bounded research for people to understand and for agents to
reproduce. Follow the repository's root contributor guide and the Lab's
`README.md` and `src/docs/validation-workflow.md`.

## Experiment page design

- **Use one reading column at every width.** On new and redesigned pages, lead
  with the title, the same badge as the catalogue card, and one short finding
  when available. Put the controls and live renders next. Keep diagnostics,
  run data, limits, and evidence visible in the same column below the demo.
- **Keep headings and copy concise.** Let the badge stand on its own. Describe
  what the check found in plain words. Add a heading when it helps readers find
  a distinct section, and use section links to jump to visible content.
- **Give each independent question its own experiment.** Use cases for
  variations on the same question. Make each experiment easy to find in the
  catalogue.
- **Show the real starting layout.** Draw it with the engine the demo uses. For
  a moving graph with a Run button, show the layout paused. Fit the camera once
  on Run or Fit, then keep it still as the points move.
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
