<!-- suggested path: history/2026/2026-10-07-deck-layers-cosmos-rendering.md -->

# `CosmosGraphLayer` draws with cosmos.gl's renderer

**Commits:** `feat(graph): expose the simulation and the curve shader module for host embeddings` (`289c226`), `feat(deck-layers): CosmosGraphLayer draws with cosmos.gl's renderer — the sublayers become the Custom deck layers story` (`0559292`), `fix(deck-layers): link ribbons extrude along the on-screen tangent — square to the curve on a pitched map` (`ff17a44`), `fix(stories): a trip the trickle just started runs at least one round trip — not ended on the frame it began` (`8ffaa0e`), `refactor(stories): the custom deck layers are the story's own — straight links in their own shader, plain names, a positionSource prop` (`a632c4e`), `fix(deck-layers): a style accessor left out sends nothing — the config's default keys draw` (`c05c10c`)

`a632c4e` replaces the curve parts of two earlier commits: the curve shader module `289c226`
exported was withdrawn before release, and the curved ribbons `ff17a44` fixed became straight
links, which keep its divide by `w`.

## Why

In 3.5.0 `CosmosGraphLayer` was a composite over two sublayers of its own, each with its
own GLSL that `texelFetch`ed the simulation's position texture. That design bought
deck-native picking, `autoHighlight`, accessors and transitions, and any deck view. It also
meant the layer drew circles and lines and nothing else: every rendering option cosmos.gl
has — shapes, images, arrows, dashes, greyout, rings — would have had to be written a second
time in those shaders, as would most of cosmos's other rendering keys. The sublayers were internal and unexported, which made them a source of
confusion: they looked like the start of a second renderer.

The maintainer's call was the other way round: the deck layer should use cosmos.gl's
rendering in full, and the sublayers should go. An experiment — a one-method deck layer
over the engine's host-embedding hooks, pointed at the map story — drew shapes, arrows and
curves exactly on deck's labels through zoom and pan, so the layer was rebuilt around it.

## What changed

- **`CosmosGraphLayer` is a primitive deck `Layer`**, no sublayers, no attribute manager. It
  owns a headless `Graph` on deck's device (or draws an application's, via `graph`), loads
  the data, steps the graph from deck's timeline, and in `draw()` hands deck's camera to
  cosmos with `setViewTransform` and records cosmos's own draws into deck's render pass
  with `drawToRenderPass`. The engine's two host-embedding hooks, kept since
  [host embedding](2026-08-18-host-embedding.md), carry the whole integration; no shader
  lives in the package.
- **The view** is derived per draw by projecting three space anchors (the origin, the x
  axis, the y axis) through deck's viewport: space → common via `modelMatrix` → world via
  `unprojectPosition` → pixel via `project`. That covers `OrthographicView({ flipY: false })`
  and a `MapView` at pitch 0 and bearing 0 alike — deck's Mercator world is y-up like
  cosmos's space. A rotated, pitched or y-down view is reported once and not drawn, because
  cosmos's `{k, x, y}` cannot express it.
- **`config` is cosmos.gl's `GraphConfig`** minus the keys deck owns (`DECK_OWNED_CONFIG_KEYS`,
  exported: view and zoom, frame loop, pointer callbacks, canvas). It replaces
  `simulationConfig`: with cosmos rendering, every rendering key works. `Graph.setConfig`
  starts from the defaults, so a dropped key resets by itself. The layer sets `pixelRatio`
  from deck's canvas context.
- **Deck accessors stay** (`getPointColor` in 0..255, `getPointSize`, `getLinkColor`,
  `getLinkWidth`, with `updateTriggers` and binary attributes) and are converted into
  cosmos's typed arrays on load and on trigger change. A `Float32Array` attribute is cosmos's
  own form and passes through by reference, so big graphs stay zero-copy. The units props
  (`pointSizeUnits`, `linkWidthUnits`) are gone: sizes are cosmos's.
  The four style accessors have no default. In 3.5.0 they had to: deck's attribute manager
  fills every instance of the sublayers it drew. With cosmos drawing, an accessor left out
  sends nothing, and `pointDefaultColor` / `pointDefaultSize` / `linkDefaultColor` /
  `linkDefaultWidth` draw instead — keys of `config` that would otherwise type-check and do
  nothing, under a constant uploaded over them. A channel the layer uploaded and the app
  then drops is cleared back to the config default; an array the app set on the graph
  itself is never touched. Unstyled graphs therefore draw in cosmos's grey, not the old
  blue.
- **The `Graph` is the escape hatch, and `onGraphDataLoaded` keeps it aligned.** `simulation` /
  `onSimulationCreated` became `graph` / `onGraphCreated`, handing out a full `Graph`. For
  everything the props do not cover — link strengths that change over time, shapes, arrows,
  clusters, pins — the app calls the graph directly rather than the layer growing one
  accessor per engine channel. What that needs is alignment: the layer drops array links
  whose endpoints name no point, the engine reuses a per-link array whenever its length
  still matches, and the layer loads inside deck's update, after the `setProps` that asked
  for it. `onGraphDataLoaded(info)` fires once the graph holds each load with the graph,
  what was replaced, the id→index map and the array links in the graph's order, so arrays
  sent from it line up. A throw in it goes to deck's `onError` and the load stands.
- **Picking was out of the first cut** — hover and click, `autoHighlight`, drag — and
  followed the same day: see [host picking](2026-10-07-host-picking.md). deck's
  `transitions` have no effect: a headless `Graph` forces its transition duration to 0.
- **Unpositioned points are seeded from the graph's RNG**, so `config.randomSeed` reproduces
  a layout; 3.5.0 used `Math.random`.
- **The sublayers moved to a story.** `points-layer.ts`, `links-layer.ts`, their
  uniform modules and `blend-parameters.ts` live in
  `integrations/deck-layers/src/stories/custom-deck-layers/`, as the example of a renderer
  of your own over `PositionTextureSource` — with deck's picking, `autoHighlight` and a
  drag. The links layer draws straight links with its own shader: a renderer of your own
  takes positions from cosmos.gl, not its rendering code.
- **`Graph.simulation` is public**, a backward-compatible addition: the `GraphSimulation` a
  graph runs, for a host that wants the simulation's own API.

## Example

- Every integration story migrated: *Graph layer*, *Big graph*, *Mini graphs* (headless
  `Graph`s the app owns, with `scalePointsOnZoom` so the thumbnails are the main view in
  small), *Graph on a map*.
- *Graph on a map* became the showcase. Cities are stars, hexagons and squares, routes are
  curves with arrows, and the travellers fly the routes: each route gets a hidden pinned
  waypoint at its curve's control point, a traveller on a trip is tied to home, waypoint and
  destination, and every frame the story sends strengths carrying the curve's own Bernstein
  weights at the traveller's progress — through `onGraphDataLoaded`'s link order, so they
  line up — and the resting point of that weighted pull is the drawn arc. The engine applies
  `sqrt(strength) × deg(other) / (deg(other) + deg(self))`, so the story passes
  `(weight / share)²`; rest lengths are fixed (`simulationLinkDistRandomVariationRange:
  [1, 1]`) because every strength update rebuilds the link force and would re-draw them.
  Point sizes scale with the zoom.
- New: *Custom deck layers*, the former sublayers over a standalone `GraphSimulation`, with
  hover, highlight and drag-to-pin. Its frame loop is the app's: deck's `_animate` follows the
  simulation's run state through `onSimulationStart` / `Unpause` / `Pause` / `End`, and
  `onBeforeRender` steps it.

## Alternatives considered

- **Keep the sublayers and implement cosmos's rendering options in them.** Twice the
  shaders, forever a step behind the engine. A key list deriving the sublayer props' names,
  types and defaults from `GraphConfig` was prototyped; it removes the duplication of names,
  not of shaders.
- **Expose `GraphConfig` on the old layer.** Most of its rendering keys would have
  type-checked and silently done nothing.
- **Keep both renderers in the package.** Two layers with different capabilities invite the
  same confusion the sublayers caused; the custom one is better as example code.
- **One accessor per engine channel** (`getLinkStrength` and so on). Prototyped and dropped
  for the `Graph` handle plus `onGraphDataLoaded`: one API, no second copy of the engine's.
- **Add the picking mode first.** Rendering first, picking as the next engine step, so the
  rewrite is one thing.

## Notes

- **What picking took** is in [host picking](2026-10-07-host-picking.md): a picking mode in
  cosmos's point and link draw programs, called by the layer in deck's pick pass.
- **Pitch and bearing** are an engine generalization: a view-projection matrix with the
  perspective divide and a per-vertex pixel scale in the nine shaders that read
  `transformationMatrix[0][0]` as the scalar zoom, plus ray-cast unprojection.
- **Transitions** need a host-driven transition clock in the headless `Graph`.
- **Cost of per-frame strengths**: each update runs `GraphData.update()` and rebuilds both
  link-force directions on the CPU; fine for the story's ~800 links, not a pattern for large
  graphs without an engine path that re-uploads only the strength texture.
- This is a breaking change for `@cosmos.gl/deck-layers` 3.5.0; see `migration-notes.md`.
