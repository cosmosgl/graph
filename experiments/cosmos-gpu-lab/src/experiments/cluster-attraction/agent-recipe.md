# Reproduce the cluster study

## Question and fixed plan

Can grouped WebGPU reduction preserve Cosmos cluster attraction, including
membership updates, without changing the existing numerical gates?

Read [the method](#/cluster-attraction?section=doc-method) first. Keep production
shaders, CPU reference and tolerances unchanged. This is force research, not a
replacement for the unresolved pilot picking-latency investigation.

Run the eight-point semantics case, then balanced groups, uneven groups,
one large group and supplied targets at **1,024 and 8,192 points**, in that order.
The generated inputs use the fixed seed in `data.ts`; uneven inputs have one
large group and 15 singleton groups. The eight-point case includes an empty
group, negative target, pinned/unassigned/absent points and zero/varied strengths.

Evolve each backend independently for 30 ticks. Validate ticks **1, 2, 10 and 30**
against both a CPU step from that backend's actual input and the independent CPU
trajectory. Then reset positions, rotate membership, replace targets and
strengths, and validate one step. Preserve every failed check.
Also compare WebGPU directly with WebGL at shared-input tick 1 and after the update.

For each input, restore the original membership and positions. Alternate WebGL
and WebGPU order over **two warmups and seven samples**, each containing **16
force-only evaluations of unchanged positions**. Clear/recompute group sums each
time. Report valid GPU timestamp medians and ranges per evaluation. Mark missing
timers unavailable; CPU submission/completion intervals are not GPU time.
Check aggregates again after the batches. Do not run builds/tests during timing.

## Run and retain the evidence

1. Retain a clean source revision or an exact source snapshot, including new
   files and the lockfile. Use a unique ignored directory under `captures/`.
2. Run `pnpm --filter @cosmos.gl/gpu-lab typecheck` and build before measurement.
   Focused tests are `src/experiments/cluster-attraction/cluster.test.ts` under
   the lab's existing-browser test configuration. Keep the original gate.
3. Open `#/cluster-attraction` in the **visible inline browser on the user's M3**.
   Verify actual native adapter details and successful canvas rendering. Record
   dimensions, browser, adapter and visibility. Report an environment blocker
   instead of changing browser/GPU.
4. Choose **Run declared study once**. Keep the page visible. Stop retains
   completed rows and reports cancellation. Export JSON locally, even if checks
   fail. Do not rerun merely to obtain a pass.
5. Review group sums, force and integration separately; distinguish strict
   numerical compatibility from plausible motion and descriptive GPU cost.
   The JSON includes failed checkpoint inputs/outputs and exact fixture names.
6. Publish a small reviewed record in `agent-findings/`, with source provenance,
   environment, result, remaining unknowns and reproduction instructions. Keep
   raw measurements local. A valid finding file is not scientific acceptance.

## Stopping rule

If the bounded candidate passes, move to the next missing force and compose
accepted forces later. If it fails, isolate whether sums, force arithmetic or
integration caused it and retain a replayable counterexample. Do not turn this
into an unbounded arithmetic investigation. Existing pilot responsiveness and
production-color failures stay visible; this result cannot approve migration.
