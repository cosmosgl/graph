<!-- suggested path: history/2026/2026-07-30-data-texture-addressing.md -->

# Addressing data textures by texel index

**Commits:** `fix(shaders): read data textures by texel index, never by coordinate`
(`f6c6a97`)

## Why

Ten fetches in the force shaders addressed their data textures at the texel
**corner**, `index / textureSize`. NEAREST selection is a *floor* of the
size-scaled coordinate, and a corner coordinate sits exactly on the boundary
between texel `index-1` and `index` — zero margin. A driver whose arithmetic
falls even one ULP short returns the previous texel, silently handing the shader
another point's data.

It happens constantly. Measured on an Apple M3 through ANGLE Metal, **2284 of
the 4095 texture sizes from 2 to 4096 misfetch at least one index**; at size 100,
3916 of 10000 texels read their neighbour. Only powers of two are immune, and
`pointsTextureSize` / `clustersTextureSize` are `ceil(sqrt(count))` — so roughly
half of all point counts land on an affected size. Which sizes fail is a *driver*
property rather than an arithmetic one: SwiftShader's failing set is nearly
disjoint from Metal's, so "pick a safe size" is not a workaround.

The engine's own writes never had the problem — every pass rasterises to texel
centres, `2.0 * (index + 0.5) / size - 1.0`. It was only the reads that failed to
invert them.

Users saw it in the cluster force, where the misfetch is not one term in a sum but
the entire target of the force, shared by every member of a cluster — so a whole
cluster relocates onto its neighbour. With 1089 pinned clusters
(`clustersTextureSize` 33) only **7.1%** of points reached their own cluster.

## The rule

A data texture is an array, so it is addressed by an index:

- `texelFetch(tex, ivec2(index), 0)` where an index is at hand;
- `texelFetch(tex, ivec2(gl_FragCoord.xy), 0)` in a full-screen pass that writes
  one output per element.

`texture()` survives only where the coordinate is genuinely continuous and
filtering is the point — in this codebase, the image atlas in `draw-points.frag`
and nothing else. `AGENTS.md` carries the rule.

## Why not just add the half texel

The obvious smaller fix is `(index + 0.5) / size`, which is correct: half a texel
of margin absorbs any plausible driver error. It was rejected, and the reads
*already* written that way were converted too, because the margin only hides the
fragility — it is an argument that has to be re-made at every new call site, and
the corner form is what you get when someone doesn't make it. An integer texel
does no coordinate arithmetic at all, and ignores filter and wrap state, so there
is nothing left to get wrong. This also matches the WebGL 2 GPGPU idiom, where
`texelFetch` is what replaced the WebGL 1 half-texel workaround.

For the same reason the full-screen passes stopped reading an interpolated quad
varying: a rasterised coordinate re-introduces exactly the dependence being
removed. `quad.vert`'s `textureCoords` output had no consumer left and is gone.

## Why not `textureSize()`

Considered and rejected for the size uniforms that remain. Most of them describe
the **render target** — `gl_Position` scatter destinations — which GLSL cannot
query; `textureSize()` only answers for a texture the shader samples. Others
encode a feature flag in the size (`linkStatusTextureSize > 0.0` means
highlighting is off, `imageAtlasCoordsTextureSize == 0` means no images) while a
1×1 placeholder is bound, so the builtin would report `1` and destroy the
distinction. Adopting it would have left two mechanisms for one quantity.

The one place it *is* right is `find-points-in-polygon.frag`, where the
alternative was never a uniform but a re-derivation of `ceil(sqrt(pathLength))`
that duplicated the allocation's own formula (and shadowed the builtin with a
local of the same name). That one now asks the texture.

## Two dependencies changed underneath

- **The 1×1 exit-texture stand-in.** While no point is absent, `exitTexture` is a
  1×1 all-zero texture rather than a `pointsTextureSize²` one. The
  [NaN point removal](2026-06-27-nan-point-removal.md) entry justifies it with
  "any sample returns present" — true of `texture()` with `CLAMP_TO_EDGE`. The
  shaders now `texelFetch` it at each point's own texel, which is *out of range*
  for every point but the first, so the optimisation rests instead on WebGL 2
  defining an out-of-range `texelFetch` as zero (its conformance suite tests
  exactly that; GLSL ES alone leaves it undefined). Same answer, different
  mechanism, and it is documented at the allocation.
- **Stale tracked indices.** `trackPointPositionsByIndices` bakes its texel pairs
  from the `pointsTextureSize` current at call time and never re-bakes them when
  the point count changes. A stale index used to clamp and report *some* real
  point's position; it now reads out of range and reports `(0, 0)`, so a tracked
  set lands at the origin and reads like a layout bug. Pre-existing — the symptom
  changed, and the re-bake is still owed.

## Verification

Behaviour was pinned from both directions: the bug fix had to *change* something,
the rest had to change nothing.

| check | result |
|---|---|
| pinned clusters at `clustersTextureSize` 33 | 7.1% → **100%** on the correct cluster |
| control at exact size 23 | 100% before and after |
| point counts on broken sizes (33, 55, 100) | 100% correct |
| absent points at 10% and 50% | no `NaN` reached any present point |
| render path (5000 points, 8000 links) | byte-identical frame, same SHA-256 |
| rect / polygon / sampling read-backs | identical results |
| polygon vs CPU ray casting, 5 path widths | exact match, both directions |

**Scope of that evidence:** one GPU — an Apple M3 via ANGLE Metal, plus
SwiftShader for the isolated fetch probe. No Windows/D3D11, Adreno or Mali
hardware was exercised.

## Notes for the next sweep

- **Not every shader is a `.vert`/`.frag` file.** `ForceLink/force-spring.ts`
  returns its shader from a function, because the link loop's bound is baked in.
  A codebase-wide sweep filtered by extension misses it — grep for
  `#version 300 es` instead. It was missed on the first pass here.
- **A uniform-block member spans seven places** that must move together: the
  `layout(std140)` block, its `#define` alias and the `#else` non-UBO declaration
  in the shader; the `UniformStore<{…}>` field type, `uniformTypes`,
  `defaultUniforms` and every `setUniforms` call in TypeScript. Nothing verifies
  they agree — drop a member from one side and every member after it reads from
  the wrong offset, silently. Nine members were removed here (two blocks emptied
  entirely, taking their `UniformStore` with them), each in lockstep, with every
  block's order re-checked against its `uniformTypes` afterwards.
- `npm run build` exits 0 even when TypeScript errors are printed, so a green
  build is not a type check — `npx tsc --noEmit` is.
