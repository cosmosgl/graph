# Agent recipe: replay one cancellation sum

## Question and scope

How do different addition orders handle a 1,024-number cancellation fixture?
The four numbers `16777216, 1, -16777216, 1` repeat 256 times, for an exact
total of 512. This recipe records the existing CPU float32 models and three WebGPU
sum kernels. It is one bounded replay, not the whole gravity study, a speed test,
or an acceptance decision for production.

## Prepare and run

For a result intended for later reproduction, run from a clean committed revision,
or retain an exact source snapshot containing the required staged, unstaged and
new files. Record its location. A filename list does not preserve their contents.
A run without identifiable source is provisional. Record the actual dependencies,
browser and adapter as well; a clean revision alone does not identify the device.
The Lab README's **Recording reproducible source** section gives snapshot steps.

From the repository root, record `git rev-parse HEAD` and `git status --short` so
the final account identifies the revision and any uncommitted changes. Use a
unique capture directory. This opt-in command
connects the test to the browser you open; it does not launch a second browser.
Prepare the run in the same terminal:

```sh
lab_run_id="precision-replay-$(date -u +%Y%m%dT%H%M%SZ)-$$"
lab_revision="$(git rev-parse HEAD)"
lab_snapshot=""
if [ -n "$(git status --porcelain)" ]; then lab_worktree="modified"; else lab_worktree="clean"; fi
printf 'Capture directory: experiments/cosmos-gpu-lab/captures/%s\n' "$lab_run_id"
```

For a reproducible run from modified source, follow the README snapshot steps
using this `lab_run_id`, then set `lab_snapshot` to the capture directory. Leave
it empty for a clean revision or a provisional run. Start the replay:

```sh
LAB_SOURCE_REVISION="$lab_revision" LAB_WORKTREE_STATE="$lab_worktree" LAB_SOURCE_SNAPSHOT="$lab_snapshot" LAB_ARTIFACT_RUN="$lab_run_id" LAB_PRECISION_REPLAY=1 LAB_INLINE_BROWSER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/precision-diagnostics/reproduction.test.ts
```

Keep the command running. Open its printed **Open test session** URL in the
available native browser within three minutes, and leave that tab open until the
terminal reports completion. The test uses seed 5931 for the shared diagnostic
setup, but this recipe does not assess gravity. Record the actual browser and
adapter from the artifact; the chosen browser controls the device. If WebGPU is
unavailable or a native adapter cannot be verified, report that limitation rather
than attributing the run to the historical M3 environment.

## Read the result

The command writes `precision-cancellation-replay.json` inside the printed capture
directory. It contains the fixture, source revision, working-copy state and reported snapshot path, actual
adapter and browser, CPU control values, GPU observations, checks and limits. A successful command without that file, or
with the test skipped, is not a completed replay. If the test fails before writing
a file, retain the terminal error and report the replay as incomplete.

The CPU control is exact sum **512**, serial **1**, blocked **16**, tree **512**.
The GPU results must be present and finite for this replay to complete. Their
values are observations: do not require them to reproduce a particular GPU's
rounding, and do not turn numerical accuracy or performance into a pass without
an agreed threshold. Compare the observations with the historical finding only
after naming both environments and implementations. In the historical observation
on 12 November 2026, the Apple M3 host ran headless Chrome 157 and luma
10.0.0-alpha.4. CPU and WGSL both produced **1 / 16 / 512** for serial, blocked
and tree addition on this fixture. Those values are historical observations,
not requirements for a different GPU or implementation.

## Final account

Report the command outcome and artifact path; revision, working-copy state and
source snapshot location if needed; whether the source is reproducible or provisional;
actual adapter and browser; the
CPU and GPU sums; any failed or unavailable check; and the limits above. State
that gravity, performance, other inputs and production readiness were not
assessed. Keep raw captures local. Preserve the historical result even if this
run differs.

## Investigate a new question

Before changing the fixture, count, seed or implementation, state the new
question, inputs, reference and any agreed acceptance rule. Save a separate
capture, explain how it differs from this replay and retain negative or incomplete
results. Follow the Lab's [validation workflow](#/validation-workflow) and
`experiments/cosmos-gpu-lab/AGENTS.md` for the full research contract.

For a custom input, `model.ts` contains the fixtures and CPU sum models;
`gpu.ts` exposes the diagnostic GPU paths. The existing `reproduction.test.ts`
shows how to run those paths and write a capture. Record a concise finding with
the question, observed results, limits and exact source, plus a small fixture or
instructions for constructing the input. Keep raw measurements in a unique
local capture. The [input-order follow-up](#/precision-diagnostics?section=doc-method-follow-up-input-order)
is an example.

### Record a follow-up investigation

Keep one JSON file per investigation in
`experiments/cosmos-gpu-lab/src/experiments/precision-diagnostics/agent-findings/`.
Use a lowercase, hyphenated filename as the finding's stable identifier.
The existing `input-order.json` illustrates the fields below. Put the reader-facing
result in the case's linked evidence article.

- `schemaVersion: 1`, `experiment: "precision-diagnostics"`, and `status`
  (`"complete"` or `"incomplete"`). Keep failures and incomplete work visible.
- `recordedAt` as `YYYY-MM-DD`; plain-language `question`, `result`, `limits`,
  and `environment`, including what the adapter actually reported. Use `evidence`
  to identify the retained observations and say when they are local-only.
- Write the question and result for someone who has not read the study. Start
  with the answer, explain any necessary technical terms, and keep the main
  limits short. Put test machinery and dependency details in `environment`,
  `evidence`, or `reproduction` rather than in the user-facing answer.
- `source` with a full lowercase commit `revision`, `state` (`"clean"`, `"modified"`,
  or `"unknown"`), and `snapshot`. Use `null` for an absent value. Clean source
  has a null snapshot. For modified source, retain an exact snapshot in the
  repository and give its repository-relative path. Unknown source must be
  incomplete; explain any local-only inputs in `limits`.
- A nonempty `reproduction` array with concrete steps or commands and the
  location of any needed inputs. Keep raw captures local and name their limits.
- Optional `evidenceSection` and `replaySection` slugs only when the matching
  headings already exist in **Method and findings** and this recipe, respectively.
  Check the heading names when recording the finding.

Verify the result against the capture and retained source.

### Replay the input-order follow-up

The recorded follow-up used revision `531d1fab66f3cddae3e39979c3e48dc1132e3e95`
plus the preserved test patch. Start from an isolated checkout at that revision;
set `lab_patch` to the absolute path of `experiments/cosmos-gpu-lab/fixtures/precision-order-followup.patch`
in a checkout that contains it. Install the lockfile dependencies in the isolated
checkout, then run from its root:

```sh
set -eu
set -o pipefail
test "$(git rev-parse HEAD)" = 531d1fab66f3cddae3e39979c3e48dc1132e3e95
test -z "$(git status --porcelain)"
git apply --index "$lab_patch"
mkdir -p experiments/cosmos-gpu-lab/captures
lab_capture="$(mktemp -d "$PWD/experiments/cosmos-gpu-lab/captures/precision-order-XXXXXX")"
lab_run_id="$(basename "$lab_capture")"
cp "$lab_patch" "$lab_capture/supplied.patch"
git diff --binary --full-index HEAD > "$lab_capture/source.patch"
git rev-parse HEAD > "$lab_capture/source-revision.txt"
git status --short > "$lab_capture/source-status-before.txt"
node --version > "$lab_capture/node-version.txt"
pnpm --version > "$lab_capture/pnpm-version.txt"
pnpm --filter @cosmos.gl/gpu-lab list --depth Infinity --json > "$lab_capture/dependencies.json"
if LAB_SOURCE_REVISION="$(cat "$lab_capture/source-revision.txt")" \
   LAB_WORKTREE_STATE=modified LAB_SOURCE_SNAPSHOT="$lab_capture" LAB_ARTIFACT_RUN="$lab_run_id" LAB_INLINE_BROWSER=0 \
   pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/precision-diagnostics/order-followup.test.ts 2>&1 | tee "$lab_capture/terminal.log"; then
  lab_test_status=0
else
  lab_test_status=$?
fi
printf '%s\n' "$lab_test_status" > "$lab_capture/test-exit-status.txt"
git rev-parse HEAD > "$lab_capture/source-revision-after.txt"
git status --short > "$lab_capture/source-status-after.txt"
git diff --binary --full-index HEAD > "$lab_capture/source-after.patch"
cmp "$lab_capture/source-revision.txt" "$lab_capture/source-revision-after.txt"
cmp "$lab_capture/source-status-before.txt" "$lab_capture/source-status-after.txt"
cmp "$lab_capture/source.patch" "$lab_capture/source-after.patch"
test -f "$lab_capture/order-followup-summary.json"
test "$lab_test_status" -eq 0
```

Read the 12 trial records and summary, including the actual browser and adapter.
The command completes only if the positive controls and finite-output checks pass;
the cancellation sums are observations, not a GPU accuracy gate. An unavailable
adapter or missing summary is incomplete. Repeatability in one session does not
establish behavior on other devices or production readiness.
