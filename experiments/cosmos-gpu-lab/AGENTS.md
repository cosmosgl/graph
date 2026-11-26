# GPU Lab research guide

The Lab helps readers evaluate Cosmos's readiness for WebGPU. Follow the root contributor guide,
use the [Lab README](README.md) for implementation details and the [validation workflow](src/docs/validation-workflow.md) for acceptance criteria.

## Commands and registration

- From the repository root, use `pnpm --filter @cosmos.gl/gpu-lab` followed by `lint`, `typecheck`,
  `build` or `test:gpu [test-file]`. Build the production WebGL control with `pnpm run build`
  before running the full migration suite. See [WebGPU migration checks](README.md#webgpu-migration-checks).
- Use public luma.gl APIs for GPU work, including diagnostics and tests. Lab `typecheck` runs
  `scripts/check-luma-api.mjs` on TypeScript in `src/experiments/` and `src/gpu/` to catch native GPU access.
- Register each experiment's comparison contract in `src/runtime/validation.ts`. Add its assessment
  to the research catalog maintained in [research.ts](src/app/research.ts) and [research-catalog.ts](src/app/research-catalog.ts).
  Registration rejects missing contracts, missing assessments and unknown method or evidence page IDs.
  Update `src/app/readiness/` when evidence changes a verdict. A case without an entry displays “Not assessed.”

## WebGPU migration tests

Every Lab test must check a requirement in the current migration scope and be able to catch a specific
failure in the candidate or the code it uses. Assert an observable result against expected behavior
or an independent reference. For example, click where two circles overlap and assert the visible point's ID.

Extend an existing test for a new boundary of the same requirement. Add a test for a distinct failure
mode or acceptance condition. A browser test may drive the Lab UI to exercise real GPU behavior,
such as rendering after resize or data replacement. Exclude tests solely about Lab navigation,
report formatting or mock bookkeeping. Parked experiments stay outside the migration suite.

## Page and demo design

### Layout, controls and navigation

- **Collapsible sections are forbidden on every Lab page.** Use one reading column at every width.
  Keep controls with the preview. Show settings, explanations, results and reports inline, with
  headings and direct links for long pages. Check narrow and wide layouts.
- Give independent questions their own pages and use cases for variations. After a split, match
  the title, method and catalog copy to the question. Mount only controls and diagnostics used by
  that page. Verify every control and measurement named in the copy or validation contract
  against the live demo or the recorded check that supplies it.
- For streamlined demos, prefer `showRecordedSummary: false`, a short `howItWorks` summary and
  one primary evidence document. Use `mountRunLayout(host)` to omit the generic `summarizeRun` card.
- Place each action beside its output. Group preset specs separately from per-tick measurements.
  Keep `data-run-part` regions as siblings. Reserve space for status, specs and progress so
  controls and readouts stay in place during reruns and preset switches.
- Use compact shared choices with clear labels, a visible selected state and room to tap. Rerun
  quick comparisons on click. Add a visible description when a setting or its disabled state needs
  explanation. Essential guidance must be available to touch and keyboard users. See the
  [control guidance](README.md#guidance-results-and-their-source).
- Draw the initial layout with the demo engine, paused even on direct section links. Start motion and measurement
  from their own controls. Fit the camera once on Run or Fit, then keep it still as the points move.
  Preserve the live case on section jumps, honor mode parameters and redirect renamed or removed
  `doc-<id>` links in `src/app/experiment-route.ts`.

### Copy, charts and live checks

- Lead with the active question. For visual or pointer behavior, compare the same input on WebGL
  and WebGPU and go straight to the preview and status. Show each metric once. A recorded study
  opens with its badge, question and a short finding scoped to the measured conditions.
- Keep inline explanations timeless. Name the pixel units and any simplifications of production
  Cosmos. List committed correctness cases and outcomes without run dates or repeated tables.
  Keep commands, capture paths, snapshot hashes and dependency versions in `agent-recipe.md` or
  the run record. A short hardware note or link to the test source is optional.
- Use a chart when it clarifies a result. Label the measured values, units and conditions. Give
  comparable bars a shared zero baseline and distinguish missing, timed-out and unreached steps.
- Offer in-page checks only for fast (roughly one second or less), deterministic parity suites.
  Share the Vitest cases through `src/runtime/live-checks.ts`. Show the test case and two result
  columns, the recorded baseline and `This GPU`, with a single run/stop action for the suite.
  Keep the baseline readable when WebGPU is unavailable. Omit per-row actions and JSON export.
  Stress tests and timed benchmarks stay separate. Committed Vitest runs supply the formal evidence.

## GPU runtime and lifecycle

- Isolate device creation, upload and render failures per preview. Release the failed backend
  and report the error in its panel so the other preview can continue.
- Serialize GPU operations within each view, including live checks that share its device. Wait
  for in-flight work before reconfiguring or destroying resources.
- After setup fails, keep preset and reset controls available for recovery. If a device limit
  was exceeded, name it and show the requested and supported values.
- Await `waitForGpu(device)` before starting a queue-completion benchmark timer so earlier
  submissions are excluded from the measurement.

## Running studies

- **Define the check first.** Read the study's `agent-recipe.md` when available. Declare the
  question, workload, reference, scope, environment, acceptance rules and output location.
  Replay retired tests from their recorded revision or snapshot.
- **Record provenance for timed benchmarks and failure investigations.** A clean commit SHA identifies
  the source. For uncommitted work, retain all build inputs, including staged, unstaged and new files,
  and record the snapshot location and SHA-256. Record browser, runtime-reported GPU adapter, inputs
  and dependencies. If the adapter is unidentified, record “unknown.” Never infer it from the host or
  browser. Mark results with unidentified source as provisional.
- **Isolate timing and captures.** Rebuild generated controls from the recorded source before timing.
  Follow browser visibility requirements and keep builds and tests outside the timed window. Give each
  test capture a unique `LAB_ARTIFACT_RUN`. Keep raw JSON in ignored `captures/` and small reproducible
  fixtures in the repository.
- **Scope conclusions to the evidence.** Apply the declared rules, retain failures and controls,
  identify hypotheses, and name skipped, interrupted, missing or unavailable checks. Treat
  `recorded-summary.json` and prototype views of prior runs as summaries. Use the source documents
  and captures for evidence and the study recipe for its replay scope.
