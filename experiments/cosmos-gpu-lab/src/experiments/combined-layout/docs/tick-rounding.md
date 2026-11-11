## Fixing the 8,192-point star probe

The **Aligned gravity + repulsion · diagnostic** candidate combines the production polar gravity expression with
controlled rounding and explicitly rounded repulsion integration. It removes the captured whole-tick probe
failures without changing the tolerance, CPU reference or force laws. Both star schedules pass, but communities
regress at tick 1, so this is not an accepted replacement. The original mode remains available to reproduce the counterexample.

## Follow the same starting state through the complete tick

**Isolate tick error** replays the captured failure on independent luma backends. The original replay must match
the captured output bits. It then compares two references after each stage: a local reference evaluated from
that stage's actual GPU input, and a composed reference that runs the uninterrupted CPU sequence from the
original tick input. No shader instrumentation is needed for these stage boundaries.

At point 43, gravity leaves x identical on CPU and GPU. Repulsion then produces an identical x force but a
one-ULP position difference:

| Quantity | CPU | Original WebGPU |
| --- | ---: | ---: |
| Before repulsion x | −48.28512954711914 | −48.28512954711914 |
| Repulsion force x | −75.39134979248047 | −75.39134979248047 |
| After repulsion x | −112.36778259277344 | −112.3677749633789 |
| After outgoing springs x | −0.0937042236328125 | −0.09372711181640625 |

The incoming pass leaves this leaf unchanged. The outgoing spring passes its local reference exactly but
amplifies the earlier input difference near a cancellation. Its final whole-tick error, 2.288818e−5, exceeds
this coordinate's 2.281113e−5 budget. Point 4424 has the same final error against a 2.192581e−5 budget.

For point 43, the original GPU position matches rounding `position + force × friction` once, while the CPU
rounds the product and addition separately. Friction is uploaded as 0.8500000238418579. This is consistent with
multiply-add fusion; it is not proof of the compiler's generated instructions. WGSL permits reassociation and
fusion: see [the specification](https://www.w3.org/TR/WGSL/#reassociation-and-fusion).

## Change one boundary at a time

Every replay below starts from the same captured state and uses the original whole-tick budget:

| Replay | Whole-tick failures | What it establishes |
| --- | ---: | --- |
| Original rounded products | 2 | The captured failure reproduces bit for bit |
| Replace gravity output with the composed CPU output | 1 | Gravity differences alone do not explain both failures |
| Replace repulsion output with the composed CPU output | 0 | Later spring passes can reproduce the CPU from that boundary |
| Round gravity integration | 2 | This correction does not remove the counterexample |
| Round repulsion integration | **0** | This GPU correction removes both failing coordinates |
| Round gravity and repulsion integration | 0 | Rounding gravity too is unnecessary for this capture |

CPU replacements are causal diagnostics, never implementation candidates. The repulsion-only correction makes
both previously failing coordinates match exactly; it does not make every coordinate in the tick bit-exact.
Other differences remain within their original component budgets.

## A frozen fix is not a trajectory fix

Repulsion integration alone fixes the original frozen probe, but changing the trajectory produces another
whole-tick probe failure at point 2476. Its error is 3.051758e−5 against a 3.033104e−5 budget. This new capture
replays exactly. Replacing the gravity boundary with the CPU output removes it; rounding gravity integration
alone does not.

The original WebGPU gravity used the mathematically equivalent linear shortcut `−position × strength`.
Production Cosmos and the CPU reference instead evaluate distance, angle, magnitude, cosine and sine.
Their stepwise floating-point results differ. The final **Aligned gravity + repulsion · diagnostic** mode restores
that polar expression, rounding non-trigonometric operations through luma's integer-controlled arithmetic.
The WGSL `atan2`, `cos` and `sin` remain native and need adapter-specific validation.

This aligns the operation sequence with Cosmos instead of trying to compensate for a different gravity
calculation downstream. The final candidate still performs every force and integration on the GPU.
CPU boundary substitutions remain confined to the diagnostic replay.

## The GPU correction

Reuse the existing integer-controlled luma integration kernel for the repulsion stage as well as the two spring
stages. Its normal position update rounds each multiplication and addition explicitly:

```wgsl
vec2f(
  springAdd(point.x, springMul(velocity.x, params.friction)),
  springAdd(point.y, springMul(velocity.y, params.friction))
)
```

This is still a GPU dispatch through luma's public Computation API and fp64 arithmetic module, taking the high
limb after each operation to target stepwise float32 behavior. It adds work per point, outside the ordered
neighbor loop. The final candidate additionally uses the polar gravity calculation above. Bounds, step guards, pinned/absent handling and the
independent reference remain as before. Finite-normal arithmetic and adapter-specific limits still apply.

## Validation and cost

Standalone Chrome 156 on Apple M3 ran all six 8,192-point cases with the aligned candidate: chain, star and
communities, at 100 and 300 ticks. Both stars pass all 42 scheduled checkpoints and both full-strength probes.
Both chains also pass. All six probes pass, and all 504 individual stage checks pass.

**The complete graph matrix still fails acceptance.** Communities fail the whole-tick check at tick 1 in both
schedules, despite passing their individual stages. Point 5855's x error is 5.340576e−5 against a 5.309196e−5
budget. The counterexample reproduces exactly. Replacing the gravity boundary with the CPU output removes it;
rounding gravity integration does not. The particular force operation responsible remains unisolated.

That leaves 124/126 scheduled whole-tick checks passing. The intermediate repulsion-only mode also remains a
diagnostic: it fixes the original frozen probe but introduces the point-2476 failure in its own trajectory.
No production default or tolerance is changed, and 32,768-point testing remains gated.

A separate native Chrome 157 replay established the original bit-identical capture and its stage ablations.
Subsequent automated browser runs stalled during startup, including a previously passing small multiplication
check. Their incomplete runs are not counted as passing tests. The final six-case validation and the timings
below were completed through the standalone Chrome UI, with local JSON exports. Typecheck, lint and build are
separate checks; they do not establish GPU correctness.

GPU timestamp measurements use fixed initial CPU stage inputs, rotated candidate order, two warmups and seven
samples. All 12 rows (three candidates × two stages × force/force-plus-integration) pass all ten validations
per row. Upload, compilation, CPU calculation, validation and readback are excluded.

| Force plus integration, 8,192-point star | Original products: ms median (range) | Aligned candidate: ms median (range) |
| --- | ---: | ---: |
| Gravity | 0.0164 (0.0164–0.0164) | 0.3962 (0.2502–0.4588) |
| Repulsion | 3.6864 (3.3096–4.6531) | 3.8011 (3.3260–4.1288) |

The polar gravity correction has a measurable cost. Repulsion ranges overlap substantially, so this run does
not resolve a small integration-overhead difference. Force-only rows and CPU completion times remain available
in local exports. These are isolated stage costs, not complete ticks or frame rates.

## Reproduce

1. Run the lab and select star, 8,192 points, 100 ticks, checkpoint every 10, **Distance + rounded products**.
2. Run the schedule and **Probe at α = 1**, then **Isolate tick error**. Confirm the bit check and the replay rows.
3. Select **Aligned gravity + repulsion · diagnostic**, rerun the schedule and probe. Inspect individual stages and the
   complete tick; a passing final tick must not hide earlier failures.
4. Use **Time gravity + repulsion** to compare both candidates on the same frozen CPU inputs with GPU timestamps.
   Upload, compilation, CPU prediction, validation and readback stay outside the timing interval.
5. Export JSON for local analysis. Measurement exports are not committed.

```sh
LAB_NATIVE_GPU=1 LAB_SCALE_COUNT=8192 pnpm --filter @cosmos.gl/gpu-lab test:gpu tick-isolation.test.ts
LAB_NATIVE_GPU=1 LAB_SCALE_COUNT=8192 LAB_SCALE_PRECISION=aligned pnpm --filter @cosmos.gl/gpu-lab test:gpu scaling.test.ts
```

The intermediate **Rounded repulsion step · diagnostic** mode remains available to reproduce its trajectory counterexample.
Use `LAB_SCALE_PRECISION=products` to retain the original failing acceptance result. The native baseline remains
the demo default. Other GPUs, larger graphs and broader production force settings still require validation.
