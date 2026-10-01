<!-- suggested path: history/2026/2026-09-07-deck-layers.md -->

# @cosmos.gl/deck-layers: the deck-side package, and the pnpm workspace that hosts it

**Commits:** `build: convert the repo to a pnpm workspace` (`b5c4a79`),
`build: drop engines.pnpm and stop persisting CI checkout credentials`
(`b2ce8a9`), `feat(deck-layers): scaffold @cosmos.gl/deck-layers and port the
prototype layers` (`cea3e30`), `fix(deck-layers): keep blend/depth state on
layer props` (`2bd7252`), `feat(deck-layers): rebuild CosmosPointsLayer on
deck's shader modules` (`93736b6`), `test(deck-layers): harden the picking
tests` (`2bb23c9`), `feat(deck-layers): rebuild CosmosLinksLayer on deck's
shader modules` (`9ae9c14`), `feat(deck-layers): CosmosGraphLayer — the
composite that owns its simulation` (`38c8a86`), `fix(simulation): reset host
GL state before sparse-write tracking draws` (`8fc0288`),
`feat(deck-layers): drag-to-pin on CosmosGraphLayer` (`72f4cd6`),
`feat(stories): move the deck.gl stories into the package and focus the set on
CosmosGraphLayer` (`ef15b78`), `fix(deck-layers): highlight only the hovered
sublayer` (`bcbb61b`), `build: lockstep release wiring and the CI test leg`
(`29f7d17`), `feat(deck-layers): transitions forwarding, binary styling
channels, partial position seeding` (`18d4dc5`), `feat(stories): four showcase
stories — scale, composition, live updates, control` (`a36e794`),
`fix(deck-layers): drop links whose endpoint is not a point` (`242c521`),
`fix(deck-layers): collapse zero-size points before the edge-padding divide`
(`ebc9ebb`), `fix(deck-layers): re-ingest links when getPointId changes`
(`7786c6e`), `docs(stories): an Integrations folder with the deck.gl layers
guide` (`6c64dc5`), `build(deps): pin the luma.gl and deck.gl peer ranges to
the 9.3 line` (`bbab52b`), `refactor(deck-layers): CosmosGraphLayer is the
only export` (`709e646`), ``feat(deck-layers): a layer without `points` draws
the simulation as loaded`` (`3b817b5`), `feat(deck-layers): binary links take
styling channels` (`cf3fdb6`), `feat(stories): your own simulations`
(`c068334`), `feat(stories): three deck.gl stories` (`f054461`)

## Why

The deck.gl-community RFC that motivated the host-embedding work
(visgl/deck.gl-community#704) proposed a `cosmos-layers` package living in
deck.gl-community. It was closed unmerged with no maintainer engagement, right
after this repo shipped everything the RFC asked for — leaving the adapter
package proposed, unclaimed, and buildable by nobody but us. We deliberately
reversed the documented division of labor: the deck-side package now lives in
this repo, versioned and released with the engine it wraps. That matches the
RFC's own rationale (the adapter should follow *cosmos.gl's* release cadence),
and it means the layer's API could be shaped against the real
`GraphSimulation` before either was frozen by a release.

## The workspace

The repo became a pnpm workspace without moving anything: the root stays the
publishable `@cosmos.gl/graph` and adapter packages live under
`integrations/*`. That layout was chosen over the ecosystem-standard
private-root-plus-`packages/` shape to keep the repo structure untouched — at
a known cost, accepted deliberately: changesets cannot version a workspace-root
package, so lockstep releases are script-driven instead. `pnpm bump <version>`
sets one version in every workspace manifest, `pnpm -r publish` ships whatever
isn't on the registry yet (idempotent, so lockstep re-publishing is safe), and
`scripts/check-lockstep.mjs` runs from every package's `prepublishOnly` and
from CI so a partial bump hard-fails instead of silently publishing a partial
set. Internal ranges never need editing: the package depends on the root via
`workspace:^`, which pnpm materializes to the real range at publish time. A
catalog in `pnpm-workspace.yaml` is the single home of the luma/deck version
matrix the peer contract depends on. Stories and tests keep compiling against
live source through the same alias scheme the repo already used — the root
maps `@cosmos.gl/deck-layers` to the package's `src/` in `vite.config.ts`
(which Storybook auto-merges) rather than devDepending on it, avoiding a
root↔package workspace cycle.

## The package

`@cosmos.gl/deck-layers` productionizes what previously lived as story-local
prototype code, on deck 9's own idioms:

- **`CosmosPointsLayer` / `CosmosLinksLayer`** (internal since "One public
  layer" below) — instanced quads (no
  driver-capped `gl_PointSize`; links extrude by half their width in screen
  space) built on the `project32` + `picking` shader modules with std140
  uniform-block sidecars. Positions never leave the GPU: each vertex
  `texelFetch`es the simulation's live position texture by instance index.
  Everything else is ordinary deck attributes behind accessors
  (`getPointColor`/`getPointSize`/`getLinkSource`/…, deck's 0..255 color
  convention), so constants, per-element functions, `updateTriggers`,
  transitions, and the binary `data: {length, attributes}` path all work the
  standard way — the cosmos `[src, tgt, …]` links array maps with zero copies
  as two interleaved binary attributes over one buffer. Picking costs nothing:
  deck auto-registers index-encoded picking colors, and the instance index
  *is* the point/link index. The `graph` prop is typed against the structural
  `PositionTextureSource` (anything with `getPointPositionTexture()`), never a
  concrete class, so a future engine — the planned high-dimensional embedding —
  plugs into the same layers unchanged.
- **`CosmosGraphLayer`** — the batteries-included composite. It *owns* its
  `GraphSimulation`: created on deck's device in `initializeState`, held in
  layer state (deck layer instances are throwaway descriptors; only state
  survives), reconfigured on `simulationConfig` deep-changes, destroyed in
  `finalizeState`, handed out once through `onSimulationCreated`. It advances
  the simulation exactly once per animation frame from deck's shared
  `context.timeline` — never inside `draw()`, which runs per viewport and
  again during picking — and sustains redraws via `setNeedsRedraw()` while the
  simulation runs, so deck idles on convergence with no `_animate` and no app
  render-loop wiring. Data arrives either as cosmos-native binary
  (`{length, initialPositions}` + flat link pairs, zero conversion) or as
  plain objects with accessors, where `getPointId` enables id-referencing
  links and picking returns the original records. A link exists only if both
  ends name a point: an object link that names none is dropped at ingest, with
  one warning, so the simulation and the rendering see the same set of links.
  Picking reports
  `elementType: 'point' | 'link'`; drag-to-pin (`enablePointDrag`) pins on
  grab, streams `setPointPosition` while moving, reheats the simulation at a
  low alpha so the graph responds, and suppresses view panning only while a
  point is held. Three refinements came out of building the showcase stories:
  binary points may carry styling `attributes` (accessor-keyed) so colors and
  sizes stay zero-copy at scale; `getPointPosition` may leave individual
  points `undefined` to seed them randomly, which makes layout carry-over
  across data changes a userland pattern (snapshot positions, feed survivors
  back through the accessor); and the composite forwards deck's `transitions`
  prop to its sublayers — `getSubLayerProps` doesn't — so accessor transitions
  animate.

## One public layer

Before the first stable release, the primitives stopped being package exports.
Only `CosmosGraphLayer` is public now, and the two primitive layers are its
internal sublayers. Everything that makes them safe to use lives in the
composite: resolving ids to indices, dropping links whose endpoint isn't a
point, stepping on the timeline, drag-to-pin, highlighting only the hovered
sublayer. Used on their own they left callers to keep `data` aligned with the
simulation's index space by hand, and getting that wrong silently reads the
wrong texels. Once the stories were narrowed down, none of them used the
primitives directly. Removing them while the package is still a beta costs
nothing, and removing them after a stable release would be breaking.

The two uses the primitives were meant for are covered in other ways:

- **Owning the simulation**: a new `simulation` prop. The application creates
  and destroys the simulation, and the layer steps it and renders it; whether
  the layer also loads data into it is decided by `points` (see "Who loads
  the data"). `simulationConfig` and `onSimulationCreated` apply only to a
  simulation the layer creates. A simulation on another device is rejected
  with an error, because deck's draws can't sample its textures.
- **Writing your own renderer**: `PositionTextureSource` moved to
  `@cosmos.gl/graph`, and `Graph` and `GraphSimulation` now declare
  `implements PositionTextureSource`. A Three.js or MapLibre integration can
  type against it without installing the deck package, and the sublayer
  sources remain the worked example.

## Who loads the data

The first `simulation` prop said "the layer ingests into it", and a story built
on an application's own simulation showed what that cost. Every attach wrote
the layer's points and links over whatever the simulation held, before the
device check, and never restarted it: hiding and showing the layer erased the
application's layout, a refused simulation was overwritten anyway, a settled
one came back frozen on random positions, and two layers stepped one
simulation twice per frame. `points` now decides who loads the data:

- **Without `points`** the layer writes nothing into the simulation. It draws
  the point count and links the simulation holds and follows a later
  `applyData()`, comparing both once per tick; an empty simulation is a valid
  waiting state. `links` without `points` is ignored, with a warning.
- **With `points`** the layer loads them and `links`, but only once the
  simulation is ready on deck's device, so a refused simulation is never
  written to. Reheating after a load stays the application's call, as for any
  data change.
- **One step per timeline tick per simulation**, however many layers draw it,
  so a main view and a minimap can share one application simulation. A paused
  timeline pauses the layout with it.

The binary shapes were closed at the same time, so a misspelled key is a type
error and not a silent fall back to the default styling:

```js
points: { length, initialPositions, attributes: { getPointColor, getPointSize } }
// a bare Float32Array is { pairs }
links: { pairs, attributes: { getLinkColor, getLinkWidth } }
```

- **Links got their binary channels back.** The links sublayer always had
  binary color and width slots, but they became unreachable when the
  primitives went internal, so a large graph styled its links through an
  accessor deck called per link on the CPU. The endpoints are always the
  layer's own views of `pairs`, copied by name, so nothing can replace them.
- **A channel reloads only when its own input changes**: positions on another
  `initialPositions` array, point count, object array or position accessor;
  links on another pair array, object array, endpoint accessor or id map. A
  new `points` or `links` object over the same arrays restyles in place and
  leaves the layout alone. Before, any new object re-sent the positions and
  reset the graph.
- **A binary pair that names no point keeps its index.** A pair whose end is
  out of range, fractional or `NaN` collapses in the links shader, by the
  engine's `isPointIndex` rule. Dropping it, as object links are dropped,
  would misalign the caller's color and width arrays.

## What building the consumer taught the engine

Four correctness rules came out of running the layers for real, each encoded
as a fix plus a regression test:

- **Pipeline state lives on `defaultProps.parameters`, never only at `Model`
  creation** (`2bd7252`): deck resets every model's parameters from
  `layer.props.parameters` before each draw and luma replaces rather than
  merges, so construction-time blend/depth state survives exactly one frame.
  The default must also be declared with the base layer's descriptor shape
  (`compare: 2`) — a plain object default silently drops deep comparison and a
  new-but-equal `parameters` object from the caller would read as a prop
  change every render.
- **A composite whose sublayers have separate index spaces must route
  `autoHighlight` itself** (`bcbb61b`): deck forwards one highlight color to
  every sublayer, and point *N* and link *N* encode the same picking color —
  hovering one tinted the other. The composite now highlights only the
  sublayer the hover came from and clears the rest.
- **Every raster entry point on a shared device resets the host's ambient GL
  state** (`8fc0288`): the sparse-write path (`setPointPositionsByIndices` →
  `trackPoints()`) drew without the guard the simulation step already had —
  and a settled layout is exactly when users drag. This closed the sparse-write
  half of open item 2 of the host-embedding review; the tracking draw now
  resets the state itself, which closes the rest (see
  [non-blocking position reads](2026-09-28-nonblocking-position-reads.md)).
  The CI test leg (`29f7d17`) closed item 3, and the async snapshot fence
  (item 1) landed after, in `fix(points): fence the async position read`
  (`af35256`).
- **A zero size hides a point by rule, not by luck** (`ebc9ebb`): a size of 0
  made the quad expansion divide by zero, and GPUs happen to drop the
  resulting vertex. A non-positive size now collapses the quad before the
  divide, the same way an absent point's does.

## Example

Storybook → Examples → Integrations, three stories, one per way of using the
layer, and a guide page under Integrations → deck.gl whose sections point at
them:

- **Graph layer** (`integrations/deck-layers/src/stories/graph-layer.ts`) —
  the deck.gl way: objects and accessors, links by id, hover with the picked
  record, drag-to-pin, and actions that pause, reheat, add and remove
  clusters (surviving points keep their place through `getPointPosition`) and
  recolor through `updateTriggers` + `transitions`. The hub labels are a stock
  `TextLayer` fed by a point tracker.
- **Big graph** (`big-graph.ts`) — 100k points and their links as flat arrays
  with binary color, size and width channels, hover by index. It carries the
  internal sublayer sources as panes, the reference for a renderer of one's
  own.
- **Your own simulations** (`own-simulations.ts`) — three simulations the
  application creates and loads on deck's device, drawn by layers without
  `points`. Each has a thumbnail view, a click routes the main view to it, and
  the selected one is drawn by two layers yet steps once per frame.

The six feature-by-feature stories these replaced, and the earlier
render-pass and readback prototypes, retired in story audits; the prototypes'
patterns live in the package README and `docs/host-embedding/README.md`.
