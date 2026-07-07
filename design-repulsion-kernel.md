# Design note: selectable repulsion kernel (`simulationRepulsionKernel`)

Status: **accepted — decisions locked (see "Decisions" below); implementing.**

## Decisions

1. Key name: **`simulationRepulsionKernel`**.
2. Values: **`'inverse'` (default) / `'studentT'`**.
3. Default stays `'inverse'` — zero behavior change for existing graphs.
4. The `fresh-energy-points` story drives it from the science-mode checkbox
   (science → `'studentT'`, pretty → `'inverse'`).

## Motivation

cosmos.gl's many-body repulsion currently uses a single hard-coded kernel. When we
tried to reproduce a t-SNE-family layout in the `fresh-energy-points` story, this
was the one remaining *structural* deviation we could not fix from the story: t-SNE
repels with a Student-t kernel, cosmos repels with a `1/d` kernel. Everything else
(kNN attraction, Barnes-Hut aggregation with `theta`, per-point energy as a learning
rate) can already be matched via the public API.

Making the kernel selectable turns cosmos.gl into an engine that can run an actual
t-SNE-family force layout natively — a real capability, not just demo polish — while
leaving the default behavior byte-for-byte unchanged.

## Current behavior (what's there today)

The repulsion magnitude lives in one function, `calculateAdditionalVelocity`,
duplicated **verbatim in two shaders**:

- `src/modules/ForceManyBody/force-level.frag` — the Barnes-Hut hierarchy cells.
- `src/modules/ForceManyBody/force-centermass.frag` — a point's own/leaf cell.

Both compute, per interacting cell (centroid `centermass.rg/centermass.b`, mass
`centermass.b`):

```glsl
vec2 distVector = pp - centermassPosition;   // points away from the mass
float l = dot(distVector, distVector);        // l = d^2
float c = alpha * repulsion * centermass.b;   // strength * mass

float distanceMin2 = 1.0;                      // soften close range
if (l < distanceMin2) l = sqrt(distanceMin2 * l);
float addV = c / sqrt(l);                       // magnitude ~ c/d
add = addV * normalize(distVector);
```

Net: **velocity contribution ≈ `alpha · repulsion · mass · (1/d)`**, directed away
from the cell. This is the 2D-gravity / log-potential repulsion — a sound default
for general graph layout. Aggregation over cells (the Barnes-Hut `theta` criterion)
is unchanged by this note; only the per-cell kernel is in scope.

## What t-SNE uses

The repulsive part of the t-SNE gradient uses the Student-t (Cauchy) kernel
`(1 + d²)⁻¹`. The force on point *i* from *j* is proportional to

```
(y_i − y_j) / (1 + d²)²          magnitude ≈ d / (1 + d²)²
```

Barnes-Hut t-SNE (van der Maaten 2013) aggregates this per cell: a distant cell of
`N` points contributes `≈ N · (y_i − centroid) / (1 + d²)²`. That maps directly onto
the variables we already have in the shader (`centermass.b` = `N`, `distVector` =
`y_i − centroid`, `l` = `d²`). The magnitude **rises from 0 at d=0, peaks, then
falls off like 1/d³** — much shorter-range than the current 1/d, which is exactly why
t-SNE produces tight, well-separated clusters rather than an evenly spread field.

## Proposed change

Add a config key `simulationRepulsionKernel` selecting the per-cell kernel. Only the
`add = …` computation inside `calculateAdditionalVelocity` branches; everything
around it (cell traversal, `theta`, `alpha`, `repulsion`, mass) stays identical.

```glsl
// kernel == 0 (default, 'inverse'): current behavior, magnitude ~ c/d
float distanceMin2 = 1.0;
if (l < distanceMin2) l = sqrt(distanceMin2 * l);
add = (c / sqrt(l)) * normalize(distVector);

// kernel == 1 ('studentT'): t-SNE, magnitude ~ c · d / (1 + d²)²
float denom = 1.0 + l;
add = c * distVector / (denom * denom);
```

Notes:

- The Student-t branch is **naturally finite at d=0** (numerator → 0), so it needs no
  `distanceMin2` softening and is actually simpler / more robust than the default.
- Passed to the shader as a `float` uniform (`0`/`1`) selected by a `#define` or a
  branch. Given it's a per-frame-constant uniform, a plain `if` is fine — no measurable
  divergence cost since every fragment takes the same side.
- The same two-line swap is applied to **both** frag files (they must stay in sync).

## Surface / API (additive, non-breaking)

- `config.ts`: `simulationRepulsionKernel: 'inverse' | 'studentT'` (string enum, in the
  spirit of other readable config values).
- `variables.ts`: default `'inverse'` → **existing graphs are unchanged**.
- The TS→shader boundary maps the string to a `0/1` float uniform in
  `ForceManyBody/index.ts` (added to both the `force-level` and `force-centermass`
  uniform blocks, alongside `repulsion`).
- Re-read from config each tick like the other force uniforms, so it can be toggled at
  runtime (the story would expose it on the science-mode checkbox).

No public method needed — it's a config flag, consistent with `simulationRepulsionTheta`.

## Scope / non-goals

- **Not** touching Barnes-Hut aggregation, `theta`, or the attraction/link force.
- **Not** implementing the t-SNE `Z` normalization constant. t-SNE normalizes the
  repulsion by the global sum `Z = Σ (1+d²)⁻¹`; in a live force sim `alpha · repulsion`
  already plays the role of an overall gain, so we fold the normalization into the
  `repulsion` coefficient rather than computing `Z`. This means `studentT` reproduces
  the t-SNE force *shape* (short-range, 1/d³ tail) faithfully but not its exact
  step size — appropriate for an interactive layout, and worth stating in the docs.
- **Not** adding momentum or changing the integrator (tracked separately).

## Risks

- **Two shaders must stay in sync.** Mitigation: identical edit, and a note in each
  file pointing at the other. (A longer-term cleanup could factor the kernel into a
  shared GLSL chunk, but that's out of scope here.)
- **Tuning feel.** `studentT` is much shorter-range, so a graph switched to it without
  re-tuning `simulationRepulsion` will look weakly repelled. This is expected and
  documented; the story sets an appropriate `repulsion` in its science preset.

## Open questions (need a decision before coding)

1. **Key name**: `simulationRepulsionKernel` (proposed) vs `simulationRepulsionType`
   vs `simulationRepulsionModel`.
2. **Value spelling**: `'inverse'` / `'studentT'` (proposed) vs `'default'` /
   `'tsne'` vs numeric `0` / `1`.
3. **Default**: keep `'inverse'` (proposed, zero behavior change) — confirm.
4. **Runtime-switchable**: expose the `studentT` toggle on the story's science-mode
   checkbox as well? (proposed: yes.)
