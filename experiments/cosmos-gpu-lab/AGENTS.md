# GPU Lab research guide

The Lab helps readers evaluate Cosmos's readiness for WebGPU.
Follow the root contributor guide and the Lab's
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
  Keep the controls and preview together, followed by results and supporting detail.
- **Lead with the active question.** An interactive comparison can use
  `headerContent: 'question-only'` and go straight to the live preview and its
  status readout. A recorded study opens with its badge, question and a short
  finding scoped to the measured conditions. Keep instructions in button labels or `tryIt`.
- **Prefer interactive previews for visual and pointer behavior.** For selection,
  picking or rendering parity, show the same input on WebGL and WebGPU. Keep
  the automated GPU test as the pass/fail check.
- **Offer in-page checks only for fast, deterministic parity suites.** When an
  experiment has a small correctness suite (under ~1 s), you may share its
  cases between the Vitest file and the page using `src/runtime/live-checks.ts`
  so visitors can verify them on their own GPU. Show two columns — the recorded
  baseline and `This GPU` (filled on click) — with one **run on this GPU**
  button that reads **stop** during a run. Omit per-row buttons and JSON export.
  Keep the table readable when WebGPU is unavailable, do not retrofit stress tests or timing
  benchmarks, and treat in-page runs as a live sanity check rather than formal
  evidence; committed Vitest runs remain the official record.
- **Write Lab pages for readers.** For committed correctness tests, list the cases
  and outcomes. Omit the run date from these summaries. A short hardware note
  or link to the test source is optional. Name exact units (drawing-buffer, CSS
  or device pixels) matching the canvas setup, and note when a demo shader or
  fixture simplifies production Cosmos.
  Put replay instructions in `agent-recipe.md`. Keep CLI flags, local `captures/`
  paths, snapshot hashes and dependency inventories in the runbook or run record.
- **Collapsible sections are forbidden on every Lab page.** Put settings, explanations, results,
  and run details in ordinary sections that readers can scroll to directly.
  Show reports and tables inline when a run produces them. Organize long pages
  with section headings and direct links.
- **Open demos paused.** Draw the starting layout with the demo's engine on
  load, including from section links. Start simulations and measurements from
  their own controls. Fit the camera once on Run or Fit, then keep it still as
  the points move.
- **Link directly to sections.** Use `#/experiment?section=<id>` and keep links
  near the relevant content. Preserve the live view, settings, and results
  when readers jump within a case. Honor query parameters on links that switch
  modes. When removing or renaming a doc page, redirect its old `doc-<id>`
  section in `src/app/experiment-route.ts`.
- **Chart results that benefit from a visual.** Give each mini chart one clear
  takeaway, direct labels, units, and the recorded conditions. Use the recorded
  values and a shared zero baseline for comparable bars. Show steps or phases
  when order matters. Use distinct labels for missing results, timeouts, and
  steps that were never reached.
- **Show what differs between previews.** When both pictures look the same,
  show each value once, either together in one readout or beside its own preview.
  For example, show each preview’s bounds downloads beside it and use the status
  line to say whether the layouts matched.
- **Keep headings and copy concise.** Let the badge stand on its own. Describe
  what the check found in plain words. Add a heading when it helps readers find
  a distinct section.
- **Name each experiment for what it tests.** Give independent questions
  their own pages and use cases for variations. After a split, narrow the
  page title, method heading and catalogue copy to the remaining question.
  Check that every control or measurement mentioned in the explanation exists
  in that page’s demo.
- **Use compact choice buttons.** Use `choice-control` for each labeled group
  and `choice-controls` to lay out multiple groups. Leave room to tap,
  highlight the selected option, and rerun quick comparisons on click.
- **Keep reruns steady.** Give temporary progress messages a fixed place so
  the controls and renders stay in position. Check the live page at narrow and
  wide widths.
- **Isolate preview failures.** Catch device creation, upload, and render errors
  per backend, release the failed backend before clearing it, and report
  unavailability in that panel without blocking the other backend.

## Running studies

- **Define the check before running it.** Read the existing `agent-recipe.md`
  when available. For a new study, state the question, workload, reference,
  scope, environment, acceptance rules and output location. Replay retired tests
  from the study's recorded revision or snapshot. See the Lab README for the earlier suite.
- **Record provenance for timed benchmarks and failure investigations.** A clean
  committed revision needs only its commit SHA to identify the source. For
  uncommitted work, save the exact inputs to the build, including staged,
  unstaged and new files, and record the snapshot location and SHA-256.
  Record the browser, the GPU adapter reported by the runtime, workload inputs
  and dependencies. If the adapter is unidentified, record it as unknown. Never
  infer it from the host hardware or browser. Mark runs with unidentified source as provisional.
- **Isolate timing and captures.** Rebuild generated controls from the recorded
  source before timing. Follow the study's browser visibility requirements and
  keep builds and tests outside the timed window. Give test-produced captures a
  unique `LAB_ARTIFACT_RUN`. Keep raw JSON in ignored `captures/` and small
  reproducible fixtures in the repository.
- **Report what the evidence supports.** Apply the declared acceptance rules,
  preserve failures and controls, identify hypotheses, and name missing,
  skipped, interrupted or unavailable checks. Limit conclusions to the measured
  scope. For `viewer-comparison`, `precision-diagnostics` and `pilot-viewer`,
  the prototype views and `recorded-summary.json` summarize historical runs.
  Use their source documents and captures for evidence and their recipes for replay scope.
