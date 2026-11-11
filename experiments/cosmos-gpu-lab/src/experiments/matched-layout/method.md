# Matched production layout comparison

Can Cosmos’s WebGL forces and the proposed WebGPU port produce comparable layouts under the same inputs? This page studies that question separately from runtime performance.

The WebGL lane imports the production gravity, exact/hierarchical repulsion, springs and integration GLSL, hosted through luma v10. It is not the complete production `Graph` runtime. The WebGPU lane uses luma kernels with the strict arithmetic candidate, ordered cached-small aggregation and order-preserving hub prefetch. The scalar CPU reference reproduces float32 operation order independently.

```flow
One graph, initial positions and deterministic random samples
Three independent trajectories · WebGL, WebGPU, CPU
One shared camera · no per-lane visual rescaling
Frozen common-input checks at checkpoints · original tolerances
Restore independent GPU layouts · verify position bits
Compare quality histories and full-strength residual motion
```

## Matched inputs

- Default Cosmos world origin `(2048, 2048)` for `spaceSize = 4096`; fixtures are translated into this frame before all three lanes start.
- Gravity `0.25`, repulsion `1`, friction `0.85`, spring coefficient `1`, rest distance `10`, explicit unit edge weights; cooling reaches alpha `0.001` after the selected number of ticks.
- Production repulsion routing: exact all-pairs through 4,096 points, hierarchical above it. The sample count matters only for hierarchical repulsion.
- Same deterministic jitter and hash seed each tick, point jitter samples, directional spring-distance samples and edge traversal order. Variation is `[1, 1.2]` in the varied/adaptive presets.
- Optional pin on point 0; all fixture points are present. Chain, bridged communities and star fixtures use the same point and edge IDs in every lane.

Adaptive mode uses the production occupancy tiers, affordability cap and two-observation hysteresis. For a controlled comparison, one CPU-derived decision tape is applied to every lane before tick 1 and every 30 ticks thereafter, using the CPU’s post-gravity occupancy. It is **not** production’s wall-clock sampling schedule, nor three independently adapting controllers. Exports record every decision. Bounds still come from each lane’s own post-gravity positions, with the same bounds formula and jitter.

## Numerical correctness is a separate gate

Every first, tenth and final tick starts an additional diagnostic from the **same CPU pre-tick positions** in both GPUs. Each local stage compares forces and integrated positions against the scalar oracle evaluated on that stage’s actual GPU input. The whole-tick comparison uses the uninterrupted scalar sequence from the common start. Diagnostics then restore the live independent layout and verify its position bits. They never feed CPU positions into the independent trajectories.

Repulsion/gravity retain `2e-5 + 3e-5 × |reference|`; spring stages retain `2e-6 + 2e-5 × |reference|`. Flag components remain exact. Whole ticks use the existing repulsion position budget. Neither coordinate alignment nor stress fitting is used by numerical checks. Unchecked ticks have no numerical verdict.

The relative position budget is evaluated in the actual world coordinates around 2048. Force components are checked separately at their own magnitudes; translating the coordinate system does not translate the force budget. Compare these runs with centered-coordinate studies using the stated frame and the full force checks, rather than position pass counts alone.

First failures retain input, output, alpha, sample count and tick seed for replay. Replay requires identical output bits and check results, then verifies restoration. Failures remain failures even if the pictures look similar. Probe checks are displayed separately; the first-failure replay captures ordinary checkpoints.

## Layout measurements

### Scale-fitted graph stress

For each sampled connected pair, let `d` be its unweighted shortest-path distance and `q = Euclidean distance / d`. Fit one scale `s = sum(q) / sum(q²)` for the entire drawing, then report `sqrt(mean((s × q − 1)²))`.

This measures how well geometric distances follow graph distances while removing arbitrary drawing scale. The choice follows [Size Should not Matter: Scale-invariant Stress Metrics](https://arxiv.org/html/2408.04688v1). Our RMS normalization and pair sampling are explicit lab choices.

Up to 128 points, every present vertex is a landmark and all connected pairs are included once. Above that, use 16 evenly spaced present point IDs, BFS from each, every reachable target, with duplicate landmark pairs removed. This is a deterministic landmark estimate, not full all-pairs stress or an unbiased random sample. Sampled disconnected pairs are excluded and counted. Exports contain landmark IDs and pair counts. No pairs yields no score; a fully collapsed drawing with connected pairs scores 1.

Regularly spaced IDs can favor particular roles in synthetic community graphs. Backend comparisons and schedule comparisons use the same pairs. Repeat with more landmark sets before defining absolute quality thresholds.

### Spring mismatch

RMS of `(edge length − directional rest length) / directional rest length`, including both production directional random samples. It is a force diagnostic, not a quality target: repulsion, gravity and spring forces compete, and both directions can have different rest lengths. Edge lengths use double-precision geometry; rest lengths retain the float32 production formula.

### Motion, size and trajectory drift

- RMS and maximum point motion measure change per tick. Motion divided by the resulting layout’s RMS radius makes the scale easier to interpret. A zero-radius layout has no normalized-motion score.
- RMS radius is the radius of gyration about the layout’s own mean position; exports also retain the center.
- Raw RMS/max drift compares corresponding point IDs with the independently evolved CPU trajectory. The table divides RMS by the CPU radius.
- Aligned drift removes translation and the best 2D rotation, **without scaling or reflection**. Size changes remain visible. This is only a diagnostic; pins and world-origin constraints still matter.

Cooling alone reduces motion. The **alpha = 1 probe** applies one full-strength tick to each lane’s own final geometry and measures residual motion, runs common-input numerical checks, then restores layouts and alpha. A 100-tick cooled drawing should not be called converged solely because its last tick barely moves.

Inspect the shared-camera drawings alongside scores. [Same Quality Metrics, Different Graph Drawings](https://drops.dagstuhl.de/storage/00lipics/lipics-vol357-gd2025/html/LIPIcs.GD.2025.7/LIPIcs.GD.2025.7.html) shows why a few scalar metrics do not fully characterize graph readability. This study does not yet measure crossings, label overlap, community recovery or interactive usability.

## Scope and reproduction

Open **Matched layout comparison**, choose the fixture/count/preset, then **Run comparison**, **Probe at α = 1**, and **Replay failures** if available. Export JSON for machine-local evidence. The [findings](#/matched-layout/docs/findings) state the measured configurations; results on other devices can differ.

GPU computation and drawing use luma public APIs; the CPU preview uses Canvas2D. This study reads positions after gravity and after every tick, and additionally reads diagnostic stages. It cannot supply an FPS or end-to-end WebGL/WebGPU speed ratio. Use the separate timing experiments for GPU costs.

The existing WebGL prototype reserves RGBA float slot textures; WebGPU stores two-component slots. Adaptive mode reserves up to 64 slots in both, but their byte costs differ. Grid resources are currently allocated even on the exact route. These are lab resource choices, not matched production memory-footprint claims.
