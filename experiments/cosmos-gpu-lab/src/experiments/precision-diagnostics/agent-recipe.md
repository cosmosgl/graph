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
