# @cosmos.gl/deck-layers

[deck.gl](https://deck.gl) layers for the [cosmos.gl](https://github.com/cosmosgl/graph)
GPU force simulation — **zero position readback**. The simulation runs on deck.gl's own
luma.gl device and the layers sample its live position texture with `texelFetch`:
point coordinates never leave the GPU, at hundreds of thousands of points.

Versions are released in lockstep with `@cosmos.gl/graph` — install matching versions.

## Install

```bash
npm install @cosmos.gl/deck-layers @cosmos.gl/graph @deck.gl/core@~9.3.0 @luma.gl/core@~9.3.0 @luma.gl/engine@~9.3.0 @luma.gl/shadertools@~9.3.0 @luma.gl/webgl@~9.3.0
```

`@cosmos.gl/graph`, `@deck.gl/core` and `@luma.gl/*` are peer dependencies: the whole
point is that cosmos, deck and the layers share **one** luma.gl device, which requires
one luma.gl installation. deck.gl `~9.3` pairs with luma.gl `~9.3`.

## CosmosGraphLayer

The batteries-included layer: give it points and links, it owns the rest. It creates the
`GraphSimulation` on deck's device, ingests your data, advances the simulation once per
frame from deck's timeline while it runs, and lets deck go idle when it settles — no
render-loop wiring, no `_animate`, no device plumbing.

```js
import { Deck, OrthographicView } from '@deck.gl/core'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'

new Deck({
  views: new OrthographicView(),
  initialViewState: { target: [2048, 2048, 0], zoom: -2 },
  controller: true,
  layers: [
    new CosmosGraphLayer({
      id: 'graph',
      // cosmos-native binary mode — zero copies:
      points: { length: pointCount, initialPositions }, // Float32Array [x0, y0, x1, y1, …]
      links: linkIndices,                               // Float32Array [src0, tgt0, src1, tgt1, …]
      pickable: true,
      enablePointDrag: true,
      autoHighlight: true,
    }),
  ],
})
```

Or hand it plain objects and accessors, the deck-idiomatic way — the layer builds the
id→index mapping, seeds unset positions randomly, and picking returns your original
objects:

```js
new CosmosGraphLayer({
  id: 'graph',
  points: nodes,                        // e.g. [{ id: 'a', group: 0 }, …]
  links: edges,                         // e.g. [{ source: 'a', target: 'b' }, …]
  getPointId: (p) => p.id,              // lets links reference ids
  getPointColor: (p) => COLORS[p.group],
  getPointSize: (p) => p.weight,
  simulationConfig: { simulationGravity: 0.25, simulationRepulsion: 1.5 },
  onSimulationCreated: (simulation) => { /* pause, pin, restart, sparse writes */ },
  pickable: true,
})
```

- **Picking**: `info.elementType` is `'point'` or `'link'`, `info.index` is the
  point/link index, and `info.object` is your original record in object mode.
- **Dragging** (`enablePointDrag: true`): a drag grabs the point — pinned on grab, moved
  with the pointer, released per `unpinOnDragEnd`; `dragReheatAlpha` restarts the
  simulation at a low alpha so the graph responds around the moving point. View panning
  is suppressed only while a point is grabbed.
- **Colors** follow the deck.gl convention: RGBA channels in 0..255.
- **Binary styling**: in binary mode, `points.attributes` and `links.attributes` take typed
  arrays keyed by the accessor they replace — `getPointColor`, `getPointSize`, `getLinkColor`,
  `getLinkWidth` — and deck uploads them as they are. Links then take the form
  `{ pairs, attributes }`; a bare pair array is `{ pairs }`. A new `points` or `links` object over
  the same positions or pairs restyles in place: the simulation is reloaded only when the
  positions or the pairs themselves change.
- **Curved links**: `curvedLinks` draws links as the engine's curves — rational quadratic
  Béziers — tuned by `curvedLinkSegments`, `curvedLinkWeight` and
  `curvedLinkControlPointDistance`, with the engine's names and defaults.
- **Simulation control**: pass forces and callbacks through `simulationConfig`
  (`GraphSimulationConfig` from `@cosmos.gl/graph`); take the wheel through
  `onSimulationCreated`.

### Driving the simulation the layer loads

The layer's `GraphSimulation` is yours to call — `onSimulationCreated` hands it over, and
`onSimulationDataLoaded` passes it with every load — except for what the layer does itself:

| Yours | The layer's |
|---|---|
| `setLinkStrength`, `setPointClusters`, `setClusterPositions`, `setPinnedPoint(s)`, `start` / `pause`, `trackPoints`, position reads, `setPointPosition` / `setPointPositionsByIndices` | `setPointPositions` and `setLinks`: the layer reloads them whenever `points` or `links` change |
| `setConfig`, for keys not in `simulationConfig` | the keys in `simulationConfig`, applied again whenever a new `simulationConfig` object arrives (an inline literal is new on every render) |

The layer also steps the simulation each frame while it runs (`pause()` it to step it
yourself), and with `enablePointDrag` it pins, moves and reheats the dragged point. To keep
your own pins through a drag, toggle them with `setPinnedPoint(i, …)` rather than replacing
the set.

Arrays you send per point or per link follow the simulation's indices, and a reload can
move them. `onSimulationDataLoaded` fires after each load, once the simulation holds the
new data, and maps your data to those indices: `pointIndexById` (with `getPointId`) and
`links`, the array links the simulation holds in its order. Links whose endpoints name no
point are dropped, so a link's index can differ from its index in your array. Send per-link
arrays from there, and they line up:

```js
let simulation
let loadedLinks = []
const sendStrengths = () => {
  if (!simulation) return
  simulation.setLinkStrength(Float32Array.from(loadedLinks, (link) => link.weight)) // your per-link weight
  simulation.applyData()
}

new CosmosGraphLayer({
  // …
  onSimulationDataLoaded: ({ simulation: sim, linksLoaded, links }) => {
    if (!linksLoaded || !links) return
    simulation = sim
    loadedLinks = links
    sendStrengths() // and again whenever the weights change
  },
})
```

The simulation reuses the last strength array it was sent whenever its length matches the
link count. So a new link set of the same length would pull with the old strengths in the
old order: send them again on every `linksLoaded`. Each strength update rebuilds the link
force, which also draws every link's random rest-length variation again; set
`simulationLinkDistRandomVariationRange: [1, 1]` when you update strengths often. The first
call comes when the simulation is ready, later ones during deck's layer update: calls on
the simulation are fine in both, while changes to layer props should wait.

Live examples: the *Integrations* section of the
[cosmos.gl Storybook](https://cosmosgl.github.io/graph).

## Bring your own simulation

Pass a `GraphSimulation` you created through `simulation` when the application needs to
own it: create it before the layer exists, keep it across layer removals, or drive it
from elsewhere in the app. It must run on deck's device. The layer steps it from deck's
timeline and renders it, but never configures or destroys it. `simulationConfig` and
`onSimulationCreated` apply only to a simulation the layer creates.

`points` decides who loads the data. Leave it out and the layer draws whatever the
simulation holds and follows its changes: load the simulation yourself, before or after
the layer exists, and the layout survives removing and re-adding the layer. Give the
layer `points` (and `links`) and it loads them into the simulation, over whatever it
held, once the device check has passed.

```js
let deck
const devicePromise = new Promise((resolve) => {
  deck = new Deck({ /* … */, onDeviceInitialized: resolve, layers: [] })
})

// deck's device, never destroyed by cosmos; the application loads it
const simulation = new GraphSimulation(config, devicePromise)
simulation.setPointPositions(positions)
simulation.setLinks(links)
simulation.applyData()

deck.setProps({
  // no `points`: the layer draws the simulation as loaded
  layers: [new CosmosGraphLayer({ id: 'graph', simulation, pickable: true })],
})

// Take over stepping: pause it, step it yourself, then ask deck to repaint
simulation.pause()
simulation.step()
deck.redraw()

// Teardown order matters: the device belongs to deck.
simulation.destroy()
deck.finalize()
```

Several layers can draw one simulation, say a main view and a differently styled
minimap: it steps once per frame however many layers draw it, as long as at most one of
them carries `points`. Loading new data never reheats: call `simulation.start()` after
`applyData()` when the simulation had settled.

## Your own renderer: `PositionTextureSource`

The layer's points and links are internal sublayers that `texelFetch` the live position
texture. To draw it some other way (your own deck layer, a Three.js material, a MapLibre
custom layer), type your input against `PositionTextureSource` from `@cosmos.gl/graph`.
`Graph` and `GraphSimulation` both implement it. `getPointPositionTexture()` returns a
`PointPositionTexture`: point `i` lives at texel `(i % textureSize, floor(i / textureSize))`
as `[x, y, i, unused]`, an absent point reads as NaN, and the handle changes as the
simulation ping-pongs, so re-fetch it whenever `version` changes. The sublayer sources
([points](src/cosmos-points-layer.ts), [links](src/cosmos-links-layer.ts)) are a worked
reference.

## The universal fallback: CPU readback

When you need stock deck layers (attribute transitions, extensions, text at positions),
run a headless simulation and snapshot positions into ordinary attributes — the same
recipe works with any rendering host, at the cost of a per-snapshot GPU→CPU copy.
Practical up to tens of thousands of points; throttle the snapshots.

```js
const graph = new GraphSimulation(config) // its own hidden device
// per animation frame: graph.step()
// every ~100 ms: await graph.getPointPositionsAsync(positions), then update
// a ScatterplotLayer/LineLayer with `data: {length, attributes}` and an updateTrigger
```

## Constraints

- **WebGL 2 only** — the cosmos.gl simulation is WebGL-only; the layer throws an
  actionable error on a WebGPU device.
- **One luma.gl installation** — a `Device` shared across duplicate luma.gl copies is
  not a supported boundary; keep the peer versions aligned.
- **2D** — cosmos.gl simulates in a 2D space; `OrthographicView` is the natural fit.

## License

MIT
