<!-- suggested path: history/2026/2026-08-14-nearfield-jitter.md -->

# Near-field sampling jitter: exact small-graph path + adaptive slot count

**Date:** 2026-08-14
**Commits:** `feat(stories): country-borders story reproducing near-field sampling jitter` (`776d15a`), `fix(force): exact all-pairs repulsion below 4k points; adaptive near-field sampling above` (`ea88026`), `feat(stories): replace the jitter repro with a fixed-vs-before comparison — both paths visible at HEAD` (`2fe05a6`)

## Why

The Monte-Carlo near field (`2026-07-08-many-body-repulsion.md`) re-draws each finest cell's
K = 8 sample every tick and weights it by `count/sampled`. The design treated the resulting
per-tick variance as annealing jitter — correct for pure repulsion, where the dense clump that
causes the variance disperses within ~60 ticks and the noise dies with it, sub-pixel before
anyone sees it. But when link attraction or gravity holds density up *while alpha stays high*
(long-running or reheated layouts), cell occupancy never falls toward K and the re-sampling
noise becomes permanent visible shimmer. Surfaced on a real 163-country border graph: at
equilibrium every point wandered ~0.5 units/tick with ~92° mean direction change between
consecutive ticks — a pure random walk on top of a settled layout. A CPU all-pairs reference
under identical falloff/friction/alpha was ~1000× stiller, and a CPU replica differing *only*
in the per-tick K = 8 re-sampling reproduced the GPU numbers digit-for-digit — pinning the
cause to the sampling, not integration or damping.

## What changed

Two complementary mechanisms in `src/modules/ForceManyBody/`:

- **Exact all-pairs path for small graphs** (`force-allpairs.frag`): at
  `pointsNumber ≤ ALL_PAIRS_MAX_POINTS` (4,096) the whole force is one O(n²) full-screen pass —
  same clamped inverse-distance falloff and coincident-point kick as the grid path, absent
  (NaN) points skipped, no pyramid or slot allocation at all. Exact at any occupancy, so zero
  sampling noise. Also *faster* there: depth peeling is one sequential render pass per slot
  (~0.1 ms fixed cost each), while the n² texel loop is trivial at this scale — measured
  ~1.8 ms/step at 2k points vs ~6.4 ms for a 64-slot peel. (#240 prototyped and dropped this
  path when the grid looked "effectively exact" for small graphs; sustained-density layouts are
  why it returned.)
- **Adaptive slot count via `sampler2DArray`**: the near-field slots moved from 8 hand-unrolled
  `sampler2D`s (WebGL2 texture-unit ceiling, and unrollable only by editing the shader) to one
  array texture looped with a `slotCount` uniform. `getNearFieldSlotCount` now returns
  32 (≤ 16k points) / 16 (≤ 65k) / 8 (above) — more slots extend the exactly-covered occupancy
  range and shrink residual variance (amplitude ∝ occupancy/K · 1/√K), while the ≥ 65k tier is
  cost-identical to before. Peeling ping-pongs between two plain 2D targets and copies each
  pass's result into its array layer — pass k must sample pass k−1's output, and sampling one
  layer of a texture while rendering to another layer of the same texture is a WebGL feedback
  loop.

## Results

- Country borders graph (163 points, 642 links, alpha held at 1): step 0.46 → 0.02 units/tick,
  mean turn 92.5° → 0.8° — visually still.
- A synthetic dense clump measured during the investigation (1,024 points in one finest cell):
  direction noise 0.0° in every tick window, path efficiency 1.000 — indistinguishable from
  the CPU exact reference, including the pathological gravity-confined case (260 points/cell
  forever).
- Repulsion benchmark: 2k **1.81 ms/step** (exact), 5k 3.80, 20k 2.29, 50k 3.90,
  100k 6.63, 200k 13.79 — the ≥ 100k path byte-identical in cost to before the change.

## Notes

- No config or public-API change; `simulationRepulsion` behaves as before. Not a breaking
  change — `migration-notes.md` intentionally untouched.
- The deep dive (`docs/many-body-force/README.md`) now documents the two-path structure, the
  sustained-density failure mode, and the adaptive K.

## Example

- **Repulsion Jitter: Fixed vs Before** (`src/stories/performance/country-borders-comparison.ts`,
  Storybook *Performance*): the real graph that surfaced the bug, run twice side by side with
  identical data and seed — left today's exact path (settled and still), right the pre-fix
  configuration (sampled near field, K = 8) forced back on through a story-only patch of
  ForceManyBody internals via the repo's src alias (per-instance config marker; fails loudly if
  the internals move; does not resolve against the published package). Each side has a
  step/turn meter and a trajectory panel tracing one dense-cell point over 360 ticks — a
  smooth drift arc today vs a random-walk tangle before.
- This story replaced the original single-pane repro
  (`feat(stories): country-borders story reproducing near-field sampling jitter`): after the
  fix, that story ran on the exact path and could no longer show live the shimmer it
  documented. It was committed *before* the fix precisely so the shimmer is observable at its
  own commit — that bisectable evidence remains in git history.
