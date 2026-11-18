# GPU Lab research guide

The Lab records bounded research for people to understand and for agents to
reproduce. Follow the repository's root contributor guide and the Lab's
`README.md` and `src/docs/validation-workflow.md`.

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

The live views and `recorded-summary.json` files for `viewer-comparison` and
`precision-diagnostics` are a prototype. Their small records summarize named
historical findings; they do not substitute for their source documents or raw
captures. Their recipes describe focused replays and explicitly name what remains
outside those replays.
