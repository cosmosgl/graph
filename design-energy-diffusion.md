# Design note: energy diffusion along links (`simulationEnergyDiffusion`)

Status: **accepted — decisions locked (see "Decisions" below); ready to implement.**

## Decisions

1. **Conductance = raw link strength**, uploaded into the free `.b` channel of the existing
   `biasAndStrengthTexture` (only `.r` bias and `.g` √strength are used today). Not the
   stored `sqrt(strength)`: sqrt compresses toward 1, making weak bridges conduct *more* —
   the opposite of semantic selectivity — and couples diffusion to a ForceLink encoding
   detail. The API story is one sentence: energy crossing a link is multiplied by that
   link's strength.
2. **Pinned points conduct.** Pinned = position locked; frozen = converged. A pinned
   point's own energy never affects motion (the pinned check short-circuits first), and
   non-conducting pinned hubs would shadow whole regions from wakes.
3. **Decay is a common factor** (equivalently: wavefront max → multiply by decay →
   threshold). Invariant: the global max energy shrinks geometrically every tick regardless
   of diffusion, so the system provably freezes in bounded time after the last injection.
4. **Key names: `simulationEnergyDiffusion` and `simulationEnergyDecay`**, JSDoc on both
   explicitly contrasting with the existing `simulationDecay` (global alpha cooling vs
   per-point energy).
5. **Texture layout: ping-pong the existing pinned+energy state texture**, copying the
   pinned `.r` channel through unchanged. No new state texture; `setPinnedPoints` /
   `setPointEnergies` write to the front buffer.

## Motivation

Per-point energy (`setPointEnergies`) freezes converged points while newcomers fly at full
energy — but a frozen neighborhood cannot make room for an arriving point, because energy 0
means *all* forces are ignored. The `fresh-energy-points` story works around this on the CPU:
on insertion it walks two hops of its kNN adjacency and re-energizes the neighbors (A-tSNE's
"selective re-optimization"), and it also runs the per-tick energy decay in JS, re-uploading
the full energy array every tick.

The engine already owns everything this policy needs: the link graph (adjacency textures in
`ForceLink`) and the energy state (green channel of the pinned-status texture in `Points`).
Making energy *diffuse along links* on the GPU turns the caller-side special case into a
general capability: any disturbance — an inserted point, a dragged point, a future deletion —
automatically ripples outward with distance falloff and dies out, no explicit wake calls.

## Current behavior (what's there today)

- Energy is the green channel of `pinnedStatusTexture` (`Points/index.ts`), written only by
  `setPointEnergies`, read once per force pass in `update-position.frag` as a velocity
  multiplier. The engine never changes it; decay lives in the caller.
- `ForceLink` keeps, per point, a texture with the first-link index and link count, and per
  link a `biasAndStrengthTexture` where strength is **`sqrt(inputLinkStrength)`** (default
  `1/max(minDegree, 1)` when `setLinkStrength` was never called). Two force passes run per
  tick — outgoing and incoming links — so both directions of the (directed-in-ingest) link
  list are traversed.

## Proposed change

A per-tick GPU pass (ping-pong on the energy state, structured like a `ForceLink` pass:
loop over the point's incident links, both directions) computing:

```
e_i ← max( e_i · decay,  diffusion · max over incident links j ( s_ij · e_j · decay ) )
if (e_i < freezeThreshold) e_i = 0
```

- **Max-propagation (wavefront), not summation (heat equation).** `max` reproduces the
  story's hop-falloff semantics continuously (`diffusion^hops`), is bounded by the source
  energy (a point with many energized neighbors doesn't overheat), needs no normalization
  by degree, and — combined with the threshold — provably dies out after
  `log_diffusion(threshold)` hops, so a frozen embedding stays frozen. Summation is more
  physical but needs degree normalization and can re-heat the whole graph.
- **Link strength is the conductance.** The wake spreads further along strong links than
  weak ones: with kNN-Gaussian strengths (as in the t-SNE story) the ripple follows the
  *semantic* neighborhood and barely crosses weak inter-cluster bridges. When the caller
  never sets strengths, the default strength ≈ 1 makes diffusion purely topological.
- **Decay moves into the engine too.** Diffusion and decay must live on the same side,
  otherwise the caller's per-tick `setPointEnergies` clobbers the diffused values. This also
  resolves a standing improvement: no more CPU decay loop + full-array re-upload every tick.

## Surface / API (additive, non-breaking)

- `config.ts`:
  - `simulationEnergyDiffusion` — per-hop falloff, `0..1`, default `0` = **off, zero
    behavior change** (no pass runs).
  - `simulationEnergyDecay` — per-tick multiplier, default `1` = no decay (current
    behavior: energies stay as set).
  - freeze threshold: fixed small constant (e.g. `0.01`) unless a config key proves needed.
- `index.ts`: `getPointEnergies(): Float32Array` — readback, symmetric with
  `getPointPositions`; callers driving UI from freeze events (the story's recoloring) need
  to observe the GPU-side state they no longer compute.
- `setPointEnergies` unchanged: it *injects* energy; the engine evolves it.

The story then shrinks: the insertion wake loops and the JS decay loop disappear (the
newcomer's own energy = 1 is the wake source); `onTick` keeps only the recolor logic,
driven by `getPointEnergies`.

## Scope / non-goals

- **Not** waking on drag automatically (drag currently writes positions directly); it
  becomes trivial afterwards — set the dragged point's energy to 1 and diffusion does the
  rest — but that's a separate, caller-side decision.
- **Not** changing pinning semantics: pinned points (red channel) don't move regardless of
  energy.

## Risks

- **Semantics shift**: energy stops being "exactly what the caller last set" once
  diffusion/decay are non-default. Mitigated by defaults = off and by `getPointEnergies`.
- **One more per-point pass with a link loop** per tick — comparable cost to one extra
  `ForceLink` pass; only paid when `simulationEnergyDiffusion > 0`.
- **Texture layout**: ping-ponging the shared pinned+energy texture means the pinned flag
  travels along — the diffusion shader must copy `.r` through unchanged (decision 5), and
  the CPU setters must target the front buffer.
