<!-- suggested path: history/2026/2026-10-06-deck-layers-engine-props.md -->

# Engine keys from one list, and the sublayers as a minimal default

**Commits:** <!-- TODO -->

## Why

A review of cosmos's config against the deck layer asked two questions: which of the
engine's options the layer lacks, and whether the layer could expose cosmos's config
instead of re-declaring it. The simulation half already does: `simulationConfig` is a
`Pick` of the engine's simulation keys and goes to `GraphSimulation.setConfig` as it is.
The rendering half cannot be passed through — the layer draws with its own sublayers, so a
rendering key does nothing until a sublayer implements it — but the four `curvedLink*`
props were declared three times over: their JSDoc in the composite, again in the links
sublayer, and their defaults once from `defaultConfigValues` and once by hand (19, 0.8,
0.5), where the two could drift apart.

The review also turned up plumbing bugs, none of them tied to a rendering feature.

## What changed

- **One key list** (`integrations/deck-layers/src/engine-props.ts`). `LINK_ENGINE_KEYS`
  names the engine keys the links sublayer draws with. `LinkEngineProps` is
  `Pick<GraphConfig, …>`, so their types and JSDoc are cosmos's own and travel into the
  published `.d.ts`; `LINK_ENGINE_DEFAULTS` reads `defaultConfigValues`; and the composite
  forwards the keys by the list (`pickKeys`). A key is added once. Both the composite's and
  the sublayer's props types intersect `LinkEngineProps`, and a test pins the defaults to
  cosmos's at both levels.
- **The curve's GLSL lives in the engine only.** `conicParametricCurveModule`, the luma
  shader module cosmos's own line shaders use, is exported from `@cosmos.gl/graph`, and the
  links sublayer includes it instead of a copy of the formula.
- **Fixes:**
  - A static `highlightedObjectIndex` on the composite reached both sublayers, so point N
    and link N lit up together (deck forwards it to every sublayer). It now names a point;
    the links sublayer gets `null`, and `_subLayerProps.links.highlightedObjectIndex`
    highlights a link.
  - Unpositioned points were placed with `Math.random`, so `simulationConfig.randomSeed`
    did not reproduce a layout. They are now drawn from `simulation.store.getRandomFloat`,
    the seeded RNG the engine's own layout uses.
  - A key dropped from `simulationConfig` kept its last value: `setConfig` applies only the
    keys it is given. The layer now sends `undefined` for every key the previous config had
    and the new one lacks, which `setConfig` reads as the default.
  - `transitions` forwarded to the sublayers now leave out the engine keys. deck ignores a
    transition on a prop not declared transitionable, so nothing animated twice today; the
    omission keeps that true if a key is ever made transitionable.
  - A NaN point size passed the `<= 0` zero-size guard (NaN fails every comparison). The
    guard is `!(r > 0)`, so NaN hides the point like a non-positive size.
- **The sublayers are swappable.** `renderLayers` instantiates them through
  `getSubLayerClass`, so deck's standard `_subLayerProps: { links: { type } }` works. The
  README states the default rendering is deliberately minimal — circles and lines, with
  deck's picking, highlight, accessors and transitions — and that a renderer with more
  either swaps in its own sublayer class or draws from `PositionTextureSource`.

## Alternatives considered

- **Removing the sublayers.** `CosmosGraphLayer` would then draw nothing; a deck layer
  that only steps a simulation is not a layer. They are not exported, so there is no API to
  remove. Making them swappable and saying what they are for addresses the confusion they
  could cause — that they will grow into cosmos's renderer — without taking the working
  default away.
- **Exposing all of `GraphConfig`.** About 36 of the 40 rendering keys would type-check
  and silently do nothing, and cosmos's `onClick` / drag callbacks collide with deck's.
- **A nested `renderConfig` prop.** deck diffs and transitions per top-level prop, and
  `updateTriggers` do not reach into nested objects; flat props keep deck's semantics.
- **Rendering through cosmos's own `Graph` inside deck.** Every rendering key would work
  at once, and it was tried and removed earlier (`ef15b787`): it needs a flat orthographic
  view, which rules out map views, and gives up deck picking, highlight, accessors and
  transitions.

## Notes

- `randomSeed` is still applied when the simulation is created, as the engine documents
  for `setConfig`; a later change to it has no effect. Dropping it from `simulationConfig`
  sends `undefined`, which is a no-op for the same reason.
- The `curvedLink*` props and `onSimulationDataLoaded` are not in a release yet, so this
  reshaping cost nothing. Rendering features the review ranked highest — selection
  greyout, arrows, point shapes — are deliberately not on the roadmap for the default
  sublayers; an app that needs them brings its own layer.
