## Checkpoints and failure replay

The default validation mode checks tick 1, every tenth tick and the final scheduled tick: 11 checkpoints for 100 ticks,
31 for 300. **Every tick · diagnostic** restores full validation; **Step + validate** always checks the next tick.
The alpha-1 probe is always checked. A stopped run may end between checkpoints; those ticks remain explicitly
**not validated** in the page and export. Passing checkpoints do not prove that intervening ticks would pass.

At a checkpoint, both GPU paths retain every original stage, structure, centroid and whole-tick check. Between
checkpoints, they skip CPU predictions and hierarchy readback, but still read post-gravity positions to calculate
their own grid bounds and final positions for metrics. The independent CPU trajectory continues on every tick; it
is never replaced with GPU positions. This reduces validation work without changing the simulated force sequence.
It remains a readback-heavy correctness experiment, not a throughput benchmark.

**Replay first failures** re-executes the earliest captured failing checkpoint per backend, plus a separate first
probe failure if present. A capture includes the entire tick's starting positions, alpha, original tick number
(which reproduces its deterministic sample seed), observed final positions and original check results. Replay uses
full stage validation and the same graph/settings, then restores the current GPU positions. It does not advance
cooling, CPU state or trajectory history. **Reproduced** requires identical check results and bit-identical final
positions; it does not turn the numerical failure into a pass. Restore errors stop the affected path and remain visible.

The first failed stage and whole-tick evidence remain available separately. JSON export includes captures and replay
reports, but replay currently operates on the active session; it is not an external JSON importer. No measurements
or captures are committed. To inspect an unchecked interval, rerun its deterministic settings in diagnostic mode.

Checkpoint equivalence is covered by a GPU regression: full validation and checkpoint mode produce identical
per-tick positions for both backends and CPU on the same small fixture. Tests also cover manual validation,
first/interval/final scheduling, lower readback counts, incomplete backends, stopped-run export, failing/rejected
replays and preservation of positions, alpha and history.

## Native M3 sweep: 512 and 2,048 points

Tested in standalone Chrome 156 on Apple M3 with luma.gl `10.0.0-alpha.4`. Each of the chain, connected-community
and star fixtures ran from its deterministic initial positions at 512 and 2,048 points, with both 100- and 300-tick
cooling schedules and ten-tick checkpoints. All twelve runs completed on both backends; none lost its context/device.
The original gravity/repulsion and spring tolerances were unchanged. The eight-sample hierarchical path remains
forced at both sizes: this does **not** validate production's exact-to-grid switch above 4,096 points.

The table uses CPU motion, link error and probe RMS as the baseline. Both GPU paths agreed with those metrics at the
three-significant-digit precision shown; their independent position drift is reported separately. Drift and motion
are world units; link error is dimensionless. Checkpoint failure counts exclude probes. There are 11 checked ticks
per 100-tick run and 31 per 300-tick run; unvalidated ticks must not be counted as passes.

| Points | Graph | Ticks | Failed checkpoints GL / GPU | CPU motion | CPU link error | WebGL / WebGPU drift | CPU probe RMS |
| ---: | --- | ---: | --- | ---: | ---: | --- | ---: |
| 512 | Chain | 100 | 0 / 0 | 0.00219 | 0.944 | 4.14e-5 / 5.80e-5 | 2.07 |
| 512 | Chain | 300 | 0 / 0 | 0.000840 | 0.657 | 0.00695 / 0.0109 | 0.825 |
| 512 | Communities | 100 | 0 / 0 | 0.00172 | 0.734 | 1.30e-4 / 1.87e-4 | 3.20 |
| 512 | Communities | 300 | 0 / 0 | 0.000935 | 0.669 | 6.10e-5 / 7.43e-5 | 2.72 |
| 512 | Star | 100 | 0 / 0 | 0.000510 | 1.14 | 2.06e-5 / 1.86e-5 | 8.13 |
| 512 | Star | 300 | 0 / 0 | 0.000206 | 1.16 | 1.42e-4 / 1.15e-4 | 8.31 |
| 2048 | Chain | 100 | 0 / 0 | 4.54e-3 | 2.09e+0 | 7.46e-4 / 6.83e-4 | 4.27e+0 |
| 2048 | Chain | 300 | 0 / 0 | 1.69e-3 | 1.58e+0 | 5.64e-3 / 4.80e-3 | 1.61e+0 |
| 2048 | Communities | 100 | 2 / 2 | 3.27e-3 | 1.63e+0 | 4.39e-3 / 1.01e-2 | 6.93e+0 |
| 2048 | Communities | 300 | 2 / 3 | 2.06e-3 | 1.42e+0 | 1.73e-2 / 1.68e-2 | 6.02e+0 |
| 2048 | Star | 100 | 1 / 1 | 9.91e-4 | 2.66e+0 | 5.00e-4 / 5.07e-4 | 1.90e+1 |
| 2048 | Star | 300 | 1 / 2 | 0.000388 | 2.70 | 0.00125 / 0.00334 | 19.4 |

### What passed, what did not

All six 512-point runs and both 2,048-point chain runs passed every scheduled checkpoint and alpha-1 probe. The
2,048-point community and star runs failed some checkpoints on **both** backends. Their latest cooled tick passing
must not conceal earlier failures. The **All failed checkpoints** disclosure retains the complete checked history.

The 100-tick, 2,048-point star's alpha-1 probe also failed: outgoing spring integration had six position-component
failures in WebGL and seven in WebGPU, with no force-component or whole-tick failures. The other eleven pairs of
probes passed. Ten first-failure captures across the four failing runs (including those two probes) reproduced with
**identical check results and bit-identical final positions**; every replay restored the current layout and cooling.
Replay captures the first failing tick per backend and a separate first probe failure, not every later failure.

For the 2,048-point communities, the first checkpoint had two incoming and one outgoing position-component failures
in WebGL, and one incoming and one outgoing in WebGPU. All of those first-checkpoint force checks and whole-tick
checks passed. For the 2,048-point star, the first checkpoint failed one outgoing position component on each backend.
The 300-tick star's second WebGPU failure occurred at tick 20: one outgoing position component, again with passing
force and whole-tick checks. These remain failures under the original, tighter spring-stage budget.

### A concrete cancellation case

The exported 2,048-point star capture isolates the first failing component: point 965's x coordinate (zero-based),
after the outgoing spring stage. Both backends produced these same values on their respective stage inputs:

| Quantity | Value |
| --- | ---: |
| Starting x | −38.9498176574707 |
| GPU spring force x | 45.7416877746582 |
| CPU spring force x | 45.74169158935547 |
| GPU resulting x | −0.0693819597363472 |
| CPU resulting x | −0.06937789916992188 |
| Position error | 4.06057e−6 |
| Allowed position error | 3.38756e−6 |

The force differs by one ULP and passes its relative-error budget. Multiplying by friction and adding the starting
position nearly cancels two much larger numbers. The small final coordinate has a much smaller relative-error
allowance, so the propagated error fails its position check. The observed GPU result matches a single-rounded
multiply-add of its captured force and position; this is consistent with fused arithmetic, not proof of compiler
lowering. Even separately rounding the GPU force's product would leave an error of approximately 3.81470e−6 against
the current CPU output, still outside this budget. Disabling fusion alone would therefore not fix this capture.

This is evidence for investigating **spring-force accuracy plus integration rounding near cancellation**. It is not
an argument for loosening the tolerance, and it is not a failure unique to the WebGPU port. No shader, CPU arithmetic
or acceptance budget was changed in this sweep.

### What the layouts tell us

Slower cooling reduces the chain's probe motion from 2.07 to 0.825 at 512 points and from 4.27 to 1.61 at 2,048.
Communities improve more modestly. Stars do not improve: probe motion rises slightly from 8.13 to 8.31 and from
19.0 to 19.4 respectively, even as cooled motion decreases. Full-strength discrete-tick stability and low-temperature
stillness remain different measurements; neither proves a global optimum.

Passing local checkpoints also does not promise identical trajectories. For example, the 512-point, 300-tick chain
accumulates WebGPU RMS drift of 0.0109 from CPU while all checked ticks pass. At 2,048 points the community drift is
larger still, alongside actual checkpoint failures. Graph size changes both the approximation and the problem;
these fixed-seed cases cannot establish universal layout quality or cross-device readiness.

## Reproduce the sweep

1. Run `pnpm --filter @cosmos.gl/gpu-lab dev` and open **Combined layout convergence** in a browser with native WebGPU.
2. Select **Every 10 ticks + first / final**. Run each chain, communities and star fixture at **512** and **2048** points,
   once with **100 ticks** and once with **300 ticks**. Changing a setting resets to the deterministic initial graph.
3. Inspect failed-checkpoint counts and history, then run **Probe at α = 1**. A passing final tick does not erase earlier failures.
4. Where failures exist, click **Replay first failures**. Verify reproduced checks, zero changed output components and
   successful restoration. Export JSON locally for full precision and later analysis.
5. Use **Every tick · diagnostic** for shorter investigations of unchecked intervals; stop after a complete tick.

Run `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout` for automated regression coverage.
The software-browser limitations in [Method and findings](#/combined-layout/docs/findings) still apply. The next
correctness investigation is the captured spring/integration cancellation; then test larger sizes, production-length
cooling and the actual exact-to-grid transition. This sweep is not a GPU timing result.
