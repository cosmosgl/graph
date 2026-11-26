# Replaying the frozen shape boundary check

Run the focused suite from the repository root. Give each run a fresh capture directory.

```sh
LAB_ARTIFACT_RUN="point-shapes-$(date -u +%Y%m%dT%H%M%SZ)-$$" \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/point-styling/shapes.test.ts
```

Vitest and the in-page runner execute the same nine trials from `shapes-suite.ts`. Each capture
contains the strict and practical results for production WebGL against both WebGPU modes.
The whole-size defaults at 2× are checked strictly, then the full fixture restores the half-pixel
circle for the boundary check. Fractional checks require exact closed-bounds WebGPU masks and
visible thin points. The optional WebGL coordinate probe in `fractional-1x` measures the horizontal
span of the 13.3 px circle. Its value depends on the adapter. Vitest results supply the recorded
column. In-page runs describe the visitor's GPU.

## Two-pixel probe replay

The separate verification run in `captures/point-shapes-probe-20261123-OpU9X3LH/` uses
one WebGL geometry draw and reads two adjacent pixels for the optional sprite span.
`source.json` identifies its exact source archive and SHA-256. Each case JSON records its
result and adapters, and `point-shapes-fractional-1x.json` includes the measured span.

## Recorded baseline on 23 November 2026

The nine-row automated table uses `captures/point-shapes-checks-20261123-_o58aeln/`. Its
source revision is `03063db92ddaafb1ecb7b627d7e7ff5dde422f3e` with uncommitted changes.
The archive `source.tar.gz` has SHA-256 `50100da85c4bad9313ef435c320455bce438372124bed15d32a341e057904df1`.
All nine Vitest cases passed in 943 ms including suite hooks and artifact writes.
Chrome 157 reported ANGLE Metal on Apple M3 for WebGL and Apple Metal 3 with fallback false
for WebGPU. The 13.3 px circle’s fitted WebGL span was 13.25 device pixels.
Node, pnpm and luma versions are in `source.json`.

### Earlier six-row boundary comparison

- Source revision `03063db92ddaafb1ecb7b627d7e7ff5dde422f3e` with uncommitted changes.
- Lab capture `captures/point-shapes-boundary-20261123-utvzqf_h/` contains the six rows, `source.json` and `source.tar.gz`. Archive SHA-256 `1442d46319a5a6dc501ef174dfcffaa0b67cb71f3e041e455029f7a30d5393c9`.
- Headless Chrome 157, luma.gl 10.0.0-alpha.15, Node 24.6.0, pnpm 10.15.0. WebGL reported ANGLE Metal on Apple M3. WebGPU reported Apple, Metal 3, fallback false.
- Inputs were the eight-shape, default/edge-case and fractional-circle fixtures at zoom 1, opacity 1 and pixel ratios 1 and 2. All six tests passed. Each `point-shapes-*.json` capture contains the strict and practical results for that scene and pixel ratio.
