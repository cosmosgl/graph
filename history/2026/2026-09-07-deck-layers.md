<!-- suggested path: history/2026/2026-09-07-deck-layers.md -->

# @cosmos.gl/deck-layers: the deck-side package, and the pnpm workspace that hosts it

**Commits:** `build: convert the repo to a pnpm workspace` (`7284a30`),
`build: drop engines.pnpm and stop persisting CI checkout credentials`
(`97ed1eb`), `feat(deck-layers): scaffold @cosmos.gl/deck-layers and port the
prototype layers` (`c7553fb`), `fix(deck-layers): keep blend/depth state on
layer props` (`ae5a4a1`), `feat(deck-layers): rebuild CosmosPointsLayer on
deck's shader modules` (`d0b0bd4`), `test(deck-layers): harden the picking
tests` (`9c1f365`), `feat(deck-layers): rebuild CosmosLinksLayer on deck's
shader modules` (`02ddbbd`), `feat(deck-layers): CosmosGraphLayer — the
composite that owns its simulation` (`2efa32b`), `fix(simulation): reset host
GL state before sparse-write tracking draws` (`9566be1`),
`feat(deck-layers): drag-to-pin on CosmosGraphLayer` (`395c31c`),
`feat(stories): move the deck.gl stories into the package and focus the set on
CosmosGraphLayer` (`f46843a`), `fix(deck-layers): highlight only the hovered
sublayer` (`0660c1a`), `build: lockstep release wiring and the CI test leg`
(`ee53675`), `feat(deck-layers): transitions forwarding, binary styling
channels, partial position seeding` (`735dbff`), `feat(stories): four showcase
stories — scale, composition, live updates, control` (`8a3bef3`)

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

- **`CosmosPointsLayer` / `CosmosLinksLayer`** — instanced quads (no
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
  links and picking returns the original records. Picking reports
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

## What building the consumer taught the engine

Three correctness rules came out of running the layers for real, each encoded
as a fix plus a regression test:

- **Pipeline state lives on `defaultProps.parameters`, never only at `Model`
  creation** (`ae5a4a1`): deck resets every model's parameters from
  `layer.props.parameters` before each draw and luma replaces rather than
  merges, so construction-time blend/depth state survives exactly one frame.
  The default must also be declared with the base layer's descriptor shape
  (`compare: 2`) — a plain object default silently drops deep comparison and a
  new-but-equal `parameters` object from the caller would read as a prop
  change every render.
- **A composite whose sublayers have separate index spaces must route
  `autoHighlight` itself** (`0660c1a`): deck forwards one highlight color to
  every sublayer, and point *N* and link *N* encode the same picking color —
  hovering one tinted the other. The composite now highlights only the
  sublayer the hover came from and clears the rest.
- **Every raster entry point on a shared device resets the host's ambient GL
  state** (`9566be1`): the sparse-write path (`setPointPositionsByIndices` →
  `trackPoints()`) drew without the guard the simulation step already had —
  and a settled layout is exactly when users drag. This closed open item 2 of
  the host-embedding review; the CI test leg (`ee53675`) closed item 3. Only
  the async snapshot fence (item 1) remains open.

## Example

Storybook → Examples → Integrations, six stories. The two data-mode stories:
**zero-copy graph (10k points)** — binary data, self-stepping, hover
highlight, drag-to-pin, with the primitive-layer sources as panes — and
**object data and accessors**, the deck-idiomatic on-ramp where picking hands
back the original objects. Four showcase stories cover the capability
classes: **100k points at full zero-copy scale** (binary styling channels
included), **composing with deck layers** (a stock `TextLayer` labels the
hubs in the same `Deck`), **live updates and restyling** (data changes with
userland position carry-over; animated recoloring through `updateTriggers` +
`transitions`), and **simulation control and minimap** (pause/reheat/pinning
via `onSimulationCreated`; one layer in two viewports). The earlier
render-pass and readback prototypes retired in the story audit; their
patterns live in the package README and `docs/host-embedding/README.md`.
