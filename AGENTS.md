# AGENTS.md — agent/contributor guide for cosmos.gl

`@cosmos.gl/graph` (cosmos.gl) is a GPU-accelerated force-graph **layout and rendering engine** for the
browser: WebGL 2 (via luma.gl), with the force simulation and the drawing both running in GLSL shaders,
built to render hundreds of thousands of points and links interactively. It renders node–link graphs
(points + links) and pure point/scatter layouts (points, no links). TypeScript + GLSL; no backend.

This file orients an AI agent (or a new contributor) to the codebase. For project governance and the
contribution process, see `CONTRIBUTING.md`, `CHARTER.md`, `CODE_OF_CONDUCT.md`, and `GOVERNANCE.md`.

## Codebase map (`src/`)

- `index.ts` — public API: the `Graph` class and its data-ingest methods (`setPointPositions`,
  `setLinks`, `setPointColors` / `setPointSizes` / `setPointShapes`, `setLinkColors` / `setLinkWidths`,
  `setConfig`, …). JSDoc documents the exact typed-array layout each method expects.
- `config.ts` — `GraphConfigInterface`: every configuration option (point/link styling, the
  `simulation*` forces, zoom/interaction, sampling distances). `GraphConfig` is its `Partial`.
- `variables.ts` — `defaultConfigValues`: the default value for every config key (typed to stay
  exhaustive against `GraphConfigInterface`); the single source for defaults.
- `modules/GraphData/` — the data model: the `PointShape` enum and the `GraphData` class, whose
  `inputPoint*` / `inputLink*` fields enumerate every per-element channel the engine consumes, plus
  validation and default-fill.
- `modules/` — per-force and per-render modules (ForceManyBody, ForceLink, ForceGravity, ForceCenter,
  ForceMouse, Clusters, Points, Lines, Zoom, Drag, Store), each with its GLSL shaders.
- `stories/` — Storybook examples (beginners, clusters, shapes, geospatial, experiments) plus the
  `configuration.mdx` / `api-reference.mdx` docs — the best worked examples of building the input arrays.
- `helper.ts` — utilities (e.g. `getRgbaColor`: parse a CSS/hex color into a normalized RGBA tuple).

`migration-notes.md` is the authoritative history of data-format and config changes (v1→v3: the move to
`Float32Array` ingest, the v3 config renames, RGBA normalized to 0..1). Read it before touching the
public API or config keys.

## Data model in one paragraph

The engine ingests **flat typed arrays**, not objects. `setPointPositions(Float32Array)` is
`[x0, y0, x1, y1, …]` (point count = length / 2) and establishes the index space everything else aligns
to; `setLinks(Float32Array)` is `[src0, tgt0, src1, tgt1, …]` of **point indices**. Per-element visual
channels (colors as RGBA in 0..1, sizes, widths, shapes) are parallel arrays. Presence of links ⇒ a
graph visualization; positions only ⇒ a point/scatter visualization.

## Dev workflow

Requires Node ≥ 18, npm ≥ 7.

- `npm run storybook` — the primary dev loop (live examples at `:6006`). Per `CONTRIBUTING.md`, add or
  update a Storybook example when you add a feature or change configuration / public methods.
- `npm run build` — production build (Vite, ES + UMD).
- `npm run watch` — rebuild on change.
- `npm run lint` — ESLint over `src` (`lint-staged` runs on commit). **Ensure the project lints and
  builds before opening a PR.**

## Contributing

Per `CONTRIBUTING.md`: fork, branch from `main`, code, make sure lint + build pass, add a Storybook
example if you changed behavior/config/public API, then open a PR. Contributions are MIT-licensed.

## Commits

Sign off every commit: `git commit -s` (adds the `Signed-off-by` trailer). The repo enforces **DCO**
(`.github/dco.yml`) and rejects unsigned commits from non-members. AI/tool-assisted commits also
carry a `Co-authored-by:` trailer (see the log).

**Subject** — Conventional Commits, `type(scope): summary`, lowercase, no trailing period. Types in
use: `fix`, `feat`, `docs`, `refactor`, `build`, `chore`, `perf`; scope names the area (`force`,
`points`, `transitions`, `zoom`, `links`, `stories`, `data`, …). An em-dash clause often carries the
key consequence — e.g. `fix(data): resolve NaN channels at read time — caller arrays are never edited`.

**Body** (anything non-trivial) — lead with the *problem and why it mattered*, not the "what"; frame
the fix as an invariant or contract; follow with reasoned bullets that say *why* each change, not just
the mechanic; close with the resulting guarantee. Wrap ~72 columns. The model to imitate:
`fix(data): resolve NaN size/color channels at read time` (`1c00abea`) — find it with
`git log --grep` if the hash has since been rewritten by a rebase/squash-merge.

After a behavior / config / public-API change, add or update the `history/` entry (`/history`).
