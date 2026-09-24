# @cosmos.gl/deck-layers

[deck.gl](https://deck.gl) layers for the [cosmos.gl](https://github.com/cosmosgl/graph)
GPU force simulation — **zero position readback**. The simulation runs on deck.gl's own
luma.gl device and the layers sample its live position texture with `texelFetch`:
point coordinates never leave the GPU, at hundreds of thousands of points.

Versions are released in lockstep with `@cosmos.gl/graph` — install matching versions.

## Install

```bash
npm install @cosmos.gl/deck-layers @cosmos.gl/graph @deck.gl/core @luma.gl/core @luma.gl/engine
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
- **Simulation control**: pass forces and callbacks through `simulationConfig`
  (`GraphSimulationConfig` from `@cosmos.gl/graph`); take the wheel through
  `onSimulationCreated`.

Live examples: the *Integrations* section of the
[cosmos.gl Storybook](https://cosmosgl.github.io/graph).

## Bring your own simulation

Pass a `GraphSimulation` you created through `simulation` when the application needs to
own it: create it before the layer exists, keep it across layer removals, or drive it
from elsewhere in the app. It must run on deck's device. The layer still ingests
`points` / `links` into it, steps it from deck's timeline and renders it, but never
configures or destroys it. `simulationConfig` and `onSimulationCreated` apply only to a
simulation the layer creates.

```js
let deck
const devicePromise = new Promise((resolve) => {
  deck = new Deck({ /* … */, onDeviceInitialized: resolve, layers: [] })
})

const simulation = new GraphSimulation(config, devicePromise) // deck's device, never destroyed by cosmos
deck.setProps({
  layers: [new CosmosGraphLayer({ id: 'graph', simulation, points, links, pickable: true })],
})

// Take over stepping: pause it, step it yourself, then ask deck to repaint
simulation.pause()
simulation.step()
deck.redraw()

// Teardown order matters: the device belongs to deck.
simulation.destroy()
deck.finalize()
```

Use one `CosmosGraphLayer` per simulation. A second layer would ingest the data again
and step the simulation twice per frame. To show one graph in several views, render the
same layer in every viewport.

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
