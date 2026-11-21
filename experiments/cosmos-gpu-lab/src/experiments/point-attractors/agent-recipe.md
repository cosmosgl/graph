# Reproduce the per-point attractor study

## Question and fixed plan

Can WebGPU preserve production per-point target/strength behavior and live
updates at the existing numerical gates, and what does the isolated force cost?
Read [the method](#/point-attractors?section=doc-method). Keep production GLSL,
the independent reference and acceptance criteria unchanged.

Run the 12-point semantics case, then shared-target, individual-targets, mixed
and translated inputs at **1,024 and 8,192 points**, in that order. Fixed seed:
29471. Fixed alpha 0.6, attractor coefficient 0.1, friction 0.85, integration guard
4,096. The translated family adds 2,048 to both target and starting coordinates.

For each input:

1. Evolve WebGL, WebGPU and CPU independently for 30 ticks. At **1, 2, 10, 30**,
   check force and integration against a CPU step from each GPU's own positions,
   and check its independent CPU trajectory. Compare GPUs directly at tick 1.
2. Replace targets/strengths, disable all targets, then re-enable them. Step and
   validate after each update, **without resetting positions**. Disabled-stage
   positions must stay exactly unchanged.
3. Reset all lanes to original positions and validate the updated targets again.
   Compare both GPUs directly from these identical inputs.
4. Restore original targets and positions. Alternate backend order over **two
   warmups plus seven measured batches of 16 frozen force evaluations**. Record
   valid GPU timestamps, including per-evaluation median and range; keep missing
   timers unavailable. Exclude integration, drawing, uploads and readbacks. Check
   forces and unchanged positions after timing. Run no builds/tests concurrently.

That is 144 backend/CPU rows, 18 shared-input pairs, 18 post-timing rows, and
126 measured batches plus 36 warmups. Counts describe the complete plan; do not
report a partial/cancelled study as accepted.

## Run and retain the evidence

1. Retain a clean source revision or exact source snapshot including new files
   and the lockfile in a unique ignored `captures/` directory.
2. Run lab typecheck/build and focused `src/experiments/point-attractors/attractors.test.ts`
   checks before timing, using the existing-browser configuration.
3. Open `#/point-attractors` in the **visible inline browser on the user's M3**.
   Verify native adapter identity and rendered canvases. Record actual browser,
   adapters, dimensions and visibility. Report blockers instead of substituting
   another environment. Use Step and check once as preflight; Reset afterwards.
4. Run **Run declared study once** with the page continuously visible. Stop
   preserves completed rows. Export JSON, including failures and unavailable
   timing. Do not repeat until passing.
5. Review force, integration, trajectory, skipped-stage exactness, direct pairs
   and post-timing checks separately. Failure rows retain input/output arrays;
   fixture names and source identify raw target/strength channels.
6. Publish a small reviewed `agent-findings/` record with answer, limits, source,
   evidence and reproduction instructions. Keep raw JSON local. Check that the
   finding stays readable when the live GPU viewer cannot start.

## Stopping rule

Passing this bounded matrix is enough to move to mouse repulsion. Compose the
accepted forces later in production order and measure complete frames. If this
matrix fails, retain the case and identify the failed stage before choosing a
bounded follow-up. Do not turn it into an unbounded precision investigation.
Pilot picking latency and original-color failures stay unresolved by this work.
