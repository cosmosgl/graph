## From isolated forces to a cooling layout

This experiment combines gravity, hierarchical repulsion and ordered directional springs using Cosmos's force order.
Each backend owns a single resident position pair; every force writes a fresh force field and integrates before the
next force reads those positions. Alpha decays **after** all four sub-steps. Production Cosmos is unchanged.

```flow
Gravity → integrate · Linear attraction to world origin (0, 0)
Hierarchical repulsion → integrate · Production WebGL grid or the corrected streamed WebGPU candidate
Incoming springs → integrate · Source-indexed adjacency, in original edge order
Outgoing springs → integrate · Target-indexed adjacency, reading the newly integrated positions
Cool alpha · Repeat from each backend's own current positions
```

There is no persistent momentum buffer: Cosmos's friction scales each force's position increment. Summing all forces
and integrating once, or using D3's tick order, would produce a different algorithm. The reference follows
`src/simulation.ts` and the production position integrator; cooling follows `Store.addAlpha`.

## Controlled settings

The graphs are deterministic chains, stars, connected communities or a chain with pinned endpoints. Every edge has
weight 1; rest distance is 10 with variation `[1, 1]` so length error has a clear meaning. Spring strength 1, gravity
0.25, repulsion 1 and friction 0.85 match the corresponding production defaults. Alpha starts at 1, targets 0 and
uses `alpha += (0 - alpha) * (1 - 0.001 ** (1 / decay))` after each tick.

The lab offers 100- and 300-tick cooling schedules for repeatable runs. Production's default decay is 5,000 ticks;
these shorter schedules are experiment settings, not a proposed default change. Integration keeps the existing
4,096-unit safety bound per sub-step. Collision, centering, mouse, clusters and per-point attractors are off.
The hierarchical path is forced even at small point counts; the exact-to-grid transition is not covered here.

WebGL imports the production gravity, spring and integration GLSL. WebGPU reuses the lab's streamed repulsion and
ordered spring compute shaders. Its gravity is the algebraically equivalent `-(position - origin) * alpha * gravity * 0.1`;
this avoids the polar `atan / sin / cos` evaluation in the production shader. CPU independently evaluates the polar
formula and the original spring order. Strict comparison makes numerical differences visible.

## Correctness and convergence are separate

Each GPU stage is compared against CPU arithmetic from its own preceding positions. Repulsion also checks its
hierarchy, selected sample identities and corrected centroids. The original force budgets remain unchanged:
`2e−5 + 3e−5 × |reference|` for gravity/repulsion and `2e−6 + 2e−5 × |reference|` for springs. A separate full-tick
position check starts the CPU from the GPU's beginning-of-tick positions, so stage-by-stage checks cannot hide
compounded error. Each path then continues independently, even when a finite numerical mismatch is recorded.

The view reports RMS motion per tick, RMS radius, drift from the independent CPU path, and normalized link-length
error `sqrt(mean(((edgeLength - 10) / 10)^2))`. All edge weights are 1 in these fixtures. Repulsion and gravity compete
with the springs: zero link-length error is not a general equilibrium target. These metrics describe the layout;
they do not constitute an arbitrary quality pass/fail threshold.

**Probe at α = 1** applies one full-strength diagnostic tick to each final layout and restores its original positions.
It does not advance the trajectory or cooling schedule. Large probe motion with small cooled motion shows that
low-temperature stillness does not establish full-strength stability. This tests the **discrete tick map at alpha 1**,
not an infinitesimal force residual: sequential integrations and spring predictions also change with alpha. Small
probe motion is bounded evidence about one full-strength tick, not proof of physical equilibrium, a global optimum
or long-term stability.

Every sub-step is read back to validate and to build that path's CPU bounds. Position updates and rendering remain
on the GPU through luma APIs; CPU bounds/readback overhead makes this unsuitable as a frame-rate benchmark.
GPU points and links draw from resident positions. The CPU panel uses Canvas 2D and the same camera.

## Native Apple M3 findings

Standalone Chrome on Apple M3, luma.gl `10.0.0-alpha.4`, 128 points, eight samples per cell and the corrected streamed
hierarchy. The chain and connected-community fixtures each ran from the same seeded starting positions with 100-
and 300-tick cooling schedules. All four runs passed **every stage and whole-tick check on both GPU backends**,
including the alpha-1 probes. The original tolerances above were unchanged.

Values below are rounded to three significant digits. Motion, radius and drift use world units. Link error is dimensionless.
Motion, link error, radius and probe values agreed across WebGL, WebGPU and CPU at the displayed precision.

| Graph | Ticks | Final RMS motion | Link error | RMS radius | WebGL drift vs CPU | WebGPU drift vs CPU | Probe RMS / max motion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chain | 100 | 8.59e−4 | 0.355 | 32.2 | 7.54e−6 | 6.06e−6 | 0.812 / 1.62 |
| Chain | 300 | 3.43e−4 | 0.200 | 41.8 | 4.87e−5 | 1.68e−5 | 0.354 / 0.723 |
| Communities | 100 | 7.30e−4 | 0.344 | 31.7 | 1.16e−4 | 6.49e−5 | 1.34 / 6.07 |
| Communities | 300 | 1.72e−4 | 0.389 | 37.9 | 1.68e−5 | 7.99e−6 | 1.35 / 6.55 |

After the last tick, alpha is approximately 0.001 for both schedules. Since cooling happens after integration,
the final tick used approximately 0.00107 for 100 ticks and 0.00102 for 300 ticks.

**What this demonstrates:** the checked WebGPU path preserves the combined force behavior closely on these fixtures.
There is no observed backend-dependent convergence difference here. Slower cooling improves the chain's link error
and alpha-1 probe motion, but does not improve the communities' probe motion; their link error also increases slightly.
More cooling ticks are therefore not a universal quality improvement. Small final cooled motion alone is not enough
to call either layout settled at full strength.

**What remains open:** larger graphs, default-length cooling, the exact-to-grid transition, dense/coincident starts,
other GPUs, additional forces and performance without validation readbacks. Small fixtures intentionally force the
hierarchical algorithm; these are not production-default execution paths at 128 points.

### Software-browser limitation

The automated browser suite additionally exercises 32-point chain, star, community and pinned fixtures over 20 ticks,
rendering, probe restoration, partial runs and failure exports. On software Chromium, production WebGL gravity
exceeded the unchanged CPU force tolerance: the initial chain had 31 failing force components with maximum error
about 2.75e−4. The native M3 runs above did not reproduce this failure. WebGPU passed the strict checks in the
automated runs. The suite requires strict WebGPU parity and finite, complete WebGL execution while retaining WebGL
numerical failures; its green status does **not** assert software WebGL parity.

The failing stage is isolated, but its compiler/driver cause is not established. The app retains these failures rather
than changing production GLSL or relaxing the budget. WebGPU uses linear gravity to avoid unnecessary trigonometric
approximations; WGSL does specify bounded accuracy rather than identical results for these functions
([WGSL floating-point accuracy](https://www.w3.org/TR/WGSL/#floating-point-accuracy)). That specification does not
explain the WebGL software result by itself.

## Reproduce

```sh
pnpm --filter @cosmos.gl/gpu-lab dev
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout
```

Open **Combined layout convergence**, select graph, point count and cooling schedule, then **Run cooling schedule**.
Inspect the motion and link-length curves, stage failures, and **Probe at α = 1**. Reset or change settings to compare
another schedule from the identical fixture. **Stop** finishes the current tick and preserves partial results.
**Export JSON** keeps settings, device information, per-tick checks/metrics, probe results and first-failure captures.
Store captures locally; share Markdown findings and reproduction instructions rather than measurement archives.
