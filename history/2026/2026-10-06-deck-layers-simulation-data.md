<!-- suggested path: history/2026/2026-10-06-deck-layers-simulation-data.md -->

# Driving the layer's simulation: `onSimulationDataLoaded`

**Commits:** <!-- TODO -->

## Why

The *Graph on a map* story wanted travellers that fly between cities, which takes link
strengths that change every frame. The first prototype added a `getLinkStrength` accessor
to `CosmosGraphLayer`. That covers one channel, and the engine has many more an app may
want: clusters, cluster positions, pins, collision sizes. An accessor per method would
double the simulation's API on the layer.

The layer already hands out its `GraphSimulation` through `onSimulationCreated`, and the
layer never writes link strengths or clusters. Calling `setLinkStrength` on it directly
works, with three gaps:

- **Index alignment.** Per-link arrays follow the simulation's link order. For array links
  it can differ from the order of the app's `links` array: the layer drops links whose
  endpoints name no point.
- **Silent misalignment after a reload.** The simulation keeps the last strength array it
  was sent and applies it whenever its length matches the link count. A new link set of the
  same length then pulls with the old strengths in the old order, with no warning.
- **Timing.** The layer loads links inside deck's layer update, not when the app calls
  `deck.setProps`. A strength sent right after `setProps` lands before the new links do.

## What changed

- **`onSimulationDataLoaded(info)` on `CosmosGraphLayer`.** It fires after each load of
  `points` or `links` into the simulation, once the simulation holds the new data. The
  first call comes when the simulation is ready (and again after a `simulation` swap),
  later ones during deck's layer update. It fires only when the layer loads the data (with
  `points`); a layer drawing a simulation's own data never loads, so it never fires.
- **A throw from the callback is the app's error.** It goes through deck's `raiseError` to
  `onError`, and the load stands: the layer still becomes ready after a first load, and its
  sublayers still follow the new data.
- **`CosmosGraphDataLoadedInfo` (exported)** carries:
  - `simulation`, layer-created or provided;
  - `pointsLoaded` and `linksLoaded`, for what this load replaced;
  - `pointIndexById`, for array points with `getPointId`;
  - `links`: for array links, the links the simulation holds, in its order; `null` for
    binary links or none, whose order is the caller's own pair array.

  It also fires when only the id map changed, because that changes how ids reach indices.
- **Ownership is documented** in the package README and `deck-layers.mdx`. The layer owns
  `setPointPositions`, `setLinks` and the keys in `simulationConfig`; the rest is the app's,
  beside the layer's stepping and drag handling.
- **The story** keeps the simulation from `onSimulationCreated` and records the loaded link
  order from `onSimulationDataLoaded`. Its frame loop then sends strengths over those
  loaded links, so a strength never lands on a link the simulation does not hold yet.
  - Each traveller on a trip has a home tie and an away tie.
  - Their weights (`1 - progress`, `progress`) sum to one, so the traveller rests that far
    along the line between the two cities.
  - The engine applies `sqrt(strength) × deg(other) / (deg(other) + deg(self))`, so the
    story passes `(weight / share)²` to cancel both factors.

## Alternatives considered

- **An accessor per channel (`getLinkStrength`, …).** It aligns by itself and refreshes on
  `updateTriggers`, but it adds one prop per simulation method and still gives no access to
  the rest.
- **A layer method returning the mapping.** The app would still need to know when to call
  it; a callback that fires on the load answers both questions.
- **Naming.** deck's base `Layer` already has `onDataLoad` (async data fetched), so
  `onDataLoaded` would be one letter away from it with a different meaning. The new name
  pairs with `onSimulationCreated`.

## Example

`integrations/deck-layers/src/stories/graph-on-map.ts`, Storybook *Examples / Integrations /
Graph on a map*: travellers fly between home and the city they visit, steered by link
strengths set on the simulation every frame.

## Notes

- **Cost.** Each strength update runs `GraphData.update()` and rebuilds both link-force
  directions on the CPU. That is fine for the story's ~800 links; large graphs would need an
  engine path that re-uploads only the strength texture. Each rebuild also draws every
  link's random rest length again (`ForceLink.create`), so the story sets
  `simulationLinkDistRandomVariationRange: [1, 1]` to keep its springs from wobbling.
- **Double rebuild.** The callback fires after the layer's `applyData`. An app that sends
  strengths from it rebuilds the link force a second time on each reload. Firing before the
  layer's `applyData` would avoid that, but in the callback the simulation would not yet
  hold the new data: its counts and degrees would still describe the previous load, and on
  the first load `start()` would do nothing.
- **Not addressed.** On the first load, a throwing accessor (`getPointPosition`,
  `getPointId`) still leaves the layer never ready, as it did before this change.
