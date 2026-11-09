## Investigating the 100k-star WebGL reset

**Investigation parked.** The temporary production v9 control, sample-replay bridge and fresh-Chrome
runner have been removed. The weighted-links experiment and its CPU validation remain available.

Before removal, eight fresh Chrome 156 processes on Apple M3 / ANGLE Metal compared production v9
with the lab's v10 WebGL path. Each case ran a 1k warm-up, then up to two 25-tick 100k-star trajectories,
with final-XY snapshots at ticks 1, 10 and 25 and unchanged tolerance. The cases were repeated in reverse order.

| Samples | Production v9 | Lab v10 WebGL |
| --- | --- | --- |
| Lab edge hash | Four runs passed | Four runs passed |
| Production samples | Four runs passed | Tick-12 invalid-operation error; separate tick-1 failure with Metal execution error and context loss |

Sample values alone did not explain the failures. Different allocation and pass scheduling remained;
no luma or driver defect was isolated. These are historical findings, not a currently runnable production
comparison. Native v10 WebGL stability remains unresolved, and failed runs cannot support performance
claims. The findings do not establish a failure of the WebGPU implementation.

## Corrected luma baseline: standalone Chrome on M3

**The corrected 100k star still lost its WebGL context in standalone Chrome, at tick 18/25.**
This is a native result for `luma-model-directional-v1`, separate from the historical raw-prototype
traces below. Correcting the directional bounds and using luma APIs did not eliminate the failure.

On 9 November 2026, standalone Chrome 156 successfully created a native **Apple M3 / ANGLE Metal**
context while the in-app browser remained unavailable. The diagnostic used Cosmos directional bounds,
GPU-fence synchronization, fixed default spring parameters, and no rendering or GPU timestamp queries.
A 1,000-point control completed 25 ticks. The same device then prepared 100,000 points and 99,999 links;
the capture confirms directional bounds **[99,999, 1]** and no early-exit variant.

| Corrected native check | Result | Maximum absolute component error |
| --- | --- | ---: |
| 1k star, 25 ticks | Pass at snapshots 1, 10, 25 | Not retained |
| 100k star, tick 1 | Pass, zero failures | 5.96e−8 |
| 100k star, tick 10 | Pass, zero failures | 1.19e−7 |
| 100k star, tick 18 | Context lost while waiting for fence | No snapshot |
| 100k star, tick 25 / repeat | Not reached / not attempted after loss | — |

The tolerance remained `abs(error) ≤ 2e−6 + 2e−5 × abs(reference)`. At tick 18 all four simulation
submission checkpoints returned with a healthy context. The next checkpoint was **before completion
wait (fence)**; about 3.4 ms later the context-loss event arrived. There was no successful completion
checkpoint for that tick. These are CPU observation timestamps, not measured GPU execution times.

This rules out an explanation confined to the disabled in-app browser or the old shared total-degree
bound. It does **not** identify the failing GPU instruction, prove the fence caused the failure, or
establish that the complete production Cosmos engine fails on the same graph. No performance result
was collected. The trace remains local; only these findings are retained in the repository.

Reproduce with **WebGL only → Cosmos directional bounds → GPU fence**: prepare 1,000 points and
validate 25 ticks, then prepare 100,000 points and validate again. Stop after context loss. The next
controlled investigation should isolate the corrected simulation passes and completion/readback paths,
keeping every neighbor and the same tolerance, before collecting new timing comparisons.

## Historical raw-prototype investigation

The old lab used one total-degree shader bound for both directions; production Cosmos does not.
The remaining traces below predate the luma `Model` migration and must not be read as evidence that
production Cosmos loses its context at 100k points.

The original sweep lost the WebGL context while collecting render timing for a 100,000-point star.
That identifies where the failure was observed, not necessarily which GPU operation caused it.
Every render measurement also prepares a frozen simulation tick **before** starting its timer.
The preparation therefore runs the high-degree spring shader even for a nominally render-only timing.

The follow-up investigation on 9 November 2026 used the same Apple M3 / ANGLE Metal environment.
Repeated attempts also failed around the first simulation tick, before render timing, and sometimes
produced invalid readbacks followed by an empty shader-compiler log during resource recreation.
The browser eventually disabled both WebGL and WebGPU access, including in fresh tabs.
Reloading sometimes recovered the device initially; it stopped doing so after repeated resets.

## What rendering isolation showed

**Check WebGL rendering only** uses the initial 100k-star positions. It creates resources but executes
no spring or integration draws and no GPU timer queries. It draws points, links, and both together,
first in chunks of 4,096 vertices and then in one draw per primitive type. Each result is read back in full.

All six checks completed on the native M3. The image checksums matched for each pair:

| Image | Bounded draws | Single draw | Colored pixels |
| --- | --- | --- | --- |
| Points | 3171430057 | 3171430057 | 81,575 |
| Links | 1891713395 | 1891713395 | 81,343 |
| Points + links | 2977103311 | 2977103311 | 84,402 |

The diagnostic now also compares every image byte, rather than relying solely on a checksum.
Its completion times include full image readback and first-use effects; they are **not** a replacement
for the warmed GPU timing sweep. This check rules out an unconditional inability to draw this geometry.
It does not rule out a driver failure involving simulation, queries, or accumulated GPU work.

## The lab baseline did not match Cosmos

Production `src/simulation.ts` creates two `ForceLink` instances. Each instance computes its maximum
adjacency count and compiles its own `forceFrag(maxPointDegree)`. The lab had instead compiled one
program from the maximum **total** degree and reused it for both directions.

| 100k outward star | Source-side bound | Target-side bound |
| --- | ---: | ---: |
| Old raw lab | 99,999 | 99,999 |
| Production Cosmos and corrected luma lab | 99,999 | 1 |

The earlier estimate of roughly **10 billion source-level loop iterations** described the old lab,
not production Cosmos. With the corrected bounds, the source hub walks its 99,999 neighbors and each
target leaf walks one. Points without neighbors bypass the loop. Compiler behavior means source-level
iteration counts still are not measured GPU instruction counts.

**Cosmos directional bounds** now selects the production GLSL with a separate bound per direction.
The optional **Stop at point degree** variant replaces the inner guard with an early break:

```glsl
for (float i = 0.0; i < MAX_LINKS; i += 1.0) {
  if (i >= linkAmount) break;
  // Same spring body, in the same neighbor order.
}
```

It retains every edge and the hub's serial dependency. It can trim exhausted loop tails on mixed-degree
graphs; it is not needed to give the outward star's target leaves a bound of one. Production code is
unchanged, and the original raw baseline is no longer selectable. Its old timing claims are retired.

## Evidence and limits

Automated checks compare the variant with the original over ten ticks on stars, hubs and edge cases,
including absent neighbors, duplicates, self-loops and the active collision rest-length floor. They also
compare it with the independent CPU reference. A separate 100k-star regression checks the trajectory
and timed stages against the CPU. These tests use Chromium's **software GPU adapter**; they establish
correctness on that backend, not native M3 stability or speed.

In the old raw prototype, removing empty loop tails did not make the native paired run stable. The hub still processes its neighbors sequentially. A watchdog or driver fault is not
yet proven. [Khronos's context-loss guidance](https://wikis.khronos.org/webgl/HandlingContextLost)
describes GPU resets as one possible cause of context loss, but that general mechanism does not diagnose
this specific case. Browser GPU-internals diagnostics were unavailable through the automation surface.

The backend now checks WebGL errors at untimed boundaries, yields after validation readback so pending
loss notifications can be delivered, and reports operation phases and nonempty shader error messages.
These improvements help distinguish failed execution from numerical disagreement; they do not repair a lost device.

## Native retry after restarting the browser

On 9 November 2026, restarting Codex restored both native WebGL and WebGPU access on the Apple M3.
This retry used Chrome 157; the earlier timing sweep used Chrome 156, so it is not a controlled
performance comparison with that baseline.

**Check 100k star (early exit)** completed resource setup for both backends, then failed during
**Validating WebGPU · tick 1/25** with `A valid external Instance reference no longer exists.`
No validation snapshot or timing sample was recorded. The runner had returned from the WebGL step
and synchronization before entering that phase, but an asynchronous device failure can surface later;
the phase alone does not identify which backend or operation caused the failure.

A subsequent **Restart devices** reported WebGL blocked because the page caused context loss, and
WebGPU could not request an adapter. An isolated WebGL retry was therefore unavailable. The early-exit
variant is **not a confirmed native stability fix**, and this run provides no performance comparison.

## What the finer checkpoints found

A follow-up run on the same Apple M3 / Chrome 157 used the early-exit WebGL shader with fence completion.
The first full 25-tick trajectory **passed**, including CPU checks at ticks 1, 10 and 25. Their maximum
absolute errors were about `5.96e−8`, `1.19e−7` and `7.45e−8`. Repeating the trajectory on the same device
failed at tick 1 during snapshot readback. The workload is therefore intermittently successful; earlier
failed attempts do not establish that the fence path always fails.

After a page reload recovered GPU access, a trace around each readback captured this sequence at tick 1:

| Checkpoint | Observed context state |
| --- | --- |
| Before and after resetting all position textures | Healthy |
| After both spring and both integration submissions | Healthy |
| After fence completion | Healthy |
| Before and after reading the source force | Healthy |
| Before and after reading the intermediate positions | Healthy |
| Before and after reading the target force | Healthy |
| Before and after reading the final positions | Healthy |
| `webglcontextlost` event, after the final read returned | **Lost** |
| Resumption after the readback's event-loop yield | **Lost; validation aborted** |

In that trace, the loss event arrived approximately **0.8 ms after the last `readPixels` returned**.
The completion wait had already returned roughly 3 ms before the event. These are diagnostic CPU
checkpoint timestamps, not GPU timings. All synchronous readback error checks returned without throwing;
no numerical validation snapshot was accepted from the failed tick.

**This is the exact first observed loss boundary, not the exact GPU instruction that caused it.**
The [WebGL context-loss specification](https://registry.khronos.org/webgl/specs/latest/1.0/)
queues event delivery as a task. A healthy result from `isContextLost()` before the next browser task
cannot prove that an earlier GPU or driver fault has not occurred. Consequently, neither the final
readback nor the event-loop yield can be blamed solely because the notification follows it.

A focused check of the local GPU/AGX reset, fault and timeout logs returned no matching entries for the
investigation interval. The browser supplied no additional context-loss status message. We still lack
a native driver error that would identify a watchdog, memory fault or failing command buffer.

The diagnostic now exports an ordered, bounded checkpoint trace, retains the **first** observed loss,
and clears prior trajectory results before a repeat. Completed snapshots from the current attempt survive
later exceptions. The earlier repeat capture contained successful snapshots from the preceding run;
those belong to the successful attempt and are not evidence that the failed repeat validated tick 1.
Checkpoint persistence adds CPU work and can affect scheduling; it is enabled only in the diagnostic,
not in the GPU timing sweep.

## Isolating passes and synchronization

A later diagnostic on the same M3 / Chrome 157 created **one backend per page**. It submitted no rendering
or timer queries, and checked each entire force/position output against the independent CPU reference.
The WebGL shader used the early-exit variant; the full 99,999-neighbor hub was retained.

| Native 100k-star check | WebGL, early exit | WebGPU |
| --- | --- | --- |
| Source spring, then full output readback | Pass | Pass |
| Source integration, then full output readback | Pass | Pass |
| Target spring, then full output readback | Pass | Pass |
| Target integration, then full output readback | Pass | Pass |
| All four passes together, then full snapshot readback | Pass | Pass |
| Existing 25-tick trajectory with one-pixel completion wait | Context lost at tick 1 | Not run in this isolation session |
| Trajectory with fence completion wait | Context lost at tick 1 | Not applicable |

The successful full-tick checks had a maximum absolute error of approximately `5.96e−8` and zero
failures at the unchanged tolerance. These are individual diagnostic runs, not repeated stability or
performance claims. Completion times include readback and first-use work, so they are not GPU timings.

**WebGPU is not required to trigger the failure.** The isolated WebGL trajectory failed at
`Validating WebGL · tick 1/25`, before any validation snapshot. This narrows the earlier paired failure:
we no longer need to assume an interaction between active WebGL and WebGPU devices.

The successful grouped check calls `step(false)` and reads all four outputs. The trajectory runner calls
the same step, then first reads **one pixel from the final position framebuffer** as a completion wait.
The immediate readback path therefore differs. This is evidence for testing synchronization and readback
behavior, not proof that a one-pixel read is invalid or that it alone causes the reset. Browser state,
resource lifetime and driver scheduling remain possible influences.

The isolated WebGL page now offers **GPU fence** versus **One-pixel read (baseline)** for
trajectory synchronization. The fence submits preceding work with `flush`, yields to the event loop,
and polls `clientWaitSync` without blocking. It fails on context loss, wait failure or a five-second
completion timeout and always deletes the sync. Yielding is required by the
[WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.14): a newly created fence
cannot become signaled within the same browser task.

GPU access was initially blocked after the isolated trajectory failure. A later development reload
created a context successfully, allowing one native fence comparison. Setup completed, but it too
reported context loss at `Validating WebGL · tick 1/25`, before a validation snapshot. The error named
the simulation tick, not a fence timeout. This does not locate the exact GPU fault, and residual browser
state after earlier resets is an additional confounder. **The fence variant is not a demonstrated fix.**

The fence option remains limited to the diagnostic page; the benchmark completion path and its
recorded baseline are unchanged. The automated tests passed on the software test adapter, including
individual 100k-star pass outputs, the full trajectory using fences, and fence failure/timeout cleanup.
That contrast reinforces the need for native driver isolation; it does not establish native stability.

The earlier WebGPU error is also not a diagnosis by itself: the
[GPUWeb discussion of the same Chromium message](https://github.com/gpuweb/gpuweb/discussions/4764)
explicitly calls for more evidence and a reproducible browser report. No matching upstream driver bug
has been established for this lab.

## Reproduce the isolated checks

1. Open **WebGL only** or **WebGPU only** from the weighted-links demo. Each creates one device.
2. Start with 1,000 points. **Prepare star** uploads the graph and computes the independent CPU reference,
   without submitting simulation work.
3. Run each pass individually, or **Run one grouped tick** to submit all four passes before reading their
   complete outputs. Both modes passed at 100,000 points on the tested M3.
4. **Validate 25 ticks** reproduces the existing trajectory harness. On WebGL, the synchronization selector
   chooses a fence or the original one-pixel wait. Both have failed natively at tick 1; stop after loss.
5. Export JSON locally before switching pages or preparing another case. No timer query or render draw
   is submitted by these diagnostics.

## What would resolve the remaining uncertainty

The checkpoints locate the browser notification boundary, but more synchronous health checks alone
will not reveal the original GPU fault. The next useful controlled comparison is to separate GPU
completion from snapshot transfer: compare no readback, a single selected output, all four outputs,
and asynchronous pixel-pack-buffer readback while preserving the same graph, shader and tick sequence.
Any mode without full readback is an isolation probe, not a correctness pass. Prefer a clean native
process and stop after loss so residual device state does not contaminate subsequent comparisons.
An upstream browser reproduction should include this distinction and the complete exported trace.

If the high-degree shader is confirmed as the trigger, test bounded **ordered continuation**: process a
fixed number of neighbors per pass, carry the accumulated velocity to the next pass, and retain every
edge in its original order. The neighbor delta depends on that accumulated velocity, so replacing the
hub with an ordinary parallel sum would change Cosmos's spring semantics. This is a proposed follow-up,
not an implemented or validated fix.

The last diagnostic checkpoint is saved locally before submission and after completion. Reloading shows
it under **Last saved diagnostic** even when no GPU can be created. It is one rolling checkpoint, not
an archive; use Export JSON before starting another run. Nothing is uploaded or committed.

## Run the corrected paired diagnostic

1. Start the lab with `pnpm --filter @cosmos.gl/gpu-lab dev` and open [Weighted link forces](?#/weighted-links).
2. Run **Check WebGL rendering only** to isolate the initial geometry from simulation and timer queries.
3. **Check 100k star (Cosmos bounds)** selects the corrected directional baseline, both backends and the 100k star.
   It attempts 25 validation ticks before all four timing stages. This workload has caused native GPU loss.
4. To restrict the measured backend (both devices still exist in this paired page), select **WebGL spring loop → Stop at point degree**, the desired
   **Sweep backend**, **Sweep topology → star**, and **Sweep point count → 100000**, then run
   **Sweep 1k–100k**. Do this only with available GPU access; stop after a device failure.
5. Export JSON locally to retain the shader choice, validation, timer validity and failures.
   Attempt a wider sweep only after the isolated case is stable.

The original fixed-bound variant has reset the tested browser repeatedly. A fresh browser process is
needed if even new tabs report disabled GPU access. Do not treat restoring the small demo, a successful
software test, or a valid render-only image as proof that the native 100k-star failure is fixed.

Keep the original timing table labeled as the historical raw prototype. New measurements must identify
the corrected luma baseline separately.
The acceptance criterion remains `abs(actual − expected) ≤ 2e−6 + 2e−5 × abs(expected)`.
