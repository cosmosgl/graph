# @cosmos.gl/deck-layers

A [deck.gl](https://deck.gl) layer that runs and draws a [cosmos.gl](https://github.com/cosmosgl/graph)
graph. The simulation runs on deck.gl's own luma.gl device, and **cosmos.gl's own renderer**
draws it into deck's render pass under deck's camera: positions never leave the GPU, and
everything cosmos.gl can draw — point shapes, images, curved links, arrows, dashes, greyout,
rings — is one `config` key away.

Versions are released in lockstep with `@cosmos.gl/graph` — install matching versions.

## Install

```bash
npm install @cosmos.gl/deck-layers @cosmos.gl/graph @deck.gl/core@~9.3.0 @luma.gl/core@~9.3.0 @luma.gl/engine@~9.3.0 @luma.gl/shadertools@~9.3.0 @luma.gl/webgl@~9.3.0
```

`@cosmos.gl/graph`, `@deck.gl/core` and `@luma.gl/*` are peer dependencies: the whole
point is that cosmos, deck and the layer share **one** luma.gl device, which requires
one luma.gl installation. deck.gl `~9.3` pairs with luma.gl `~9.3`.

## CosmosGraphLayer

Give it points and links, it owns the rest. It creates a headless `Graph` on deck's device,
loads your data, advances the simulation once per frame from deck's timeline while it runs
(deck goes idle when it settles), hands deck's view to cosmos.gl before each draw and lets
cosmos.gl draw — no render-loop wiring, no `_animate`, no device plumbing.

```js
import { Deck, OrthographicView } from '@deck.gl/core'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'

new Deck({
  views: new OrthographicView({ flipY: false }), // cosmos's space has y up
  initialViewState: { target: [2048, 2048, 0], zoom: -2 },
  controller: true,
  layers: [
    new CosmosGraphLayer({
      id: 'graph',
      // cosmos-native binary mode — zero copies:
      points: { length: pointCount, initialPositions }, // Float32Array [x0, y0, x1, y1, …]
      links: linkIndices,                               // Float32Array [src0, tgt0, src1, tgt1, …]
      config: { curvedLinks: true, linkDefaultArrows: true },
      pickable: true,
      enablePointDrag: true,
      autoHighlight: true,
    }),
  ],
})
```

Or hand it plain objects and accessors, the deck-idiomatic way — the layer builds the
id→index mapping and seeds unset positions randomly:

```js
new CosmosGraphLayer({
  id: 'graph',
  points: nodes,                        // e.g. [{ id: 'a', group: 0 }, …]
  links: edges,                         // e.g. [{ source: 'a', target: 'b' }, …]
  getPointId: (p) => p.id,              // lets links reference ids
  getPointColor: (p) => COLORS[p.group],
  getPointSize: (p) => p.weight,
  config: { simulationGravity: 0.25, simulationRepulsion: 1.5, pointDefaultShape: PointShape.Hexagon },
  onGraphCreated: (graph) => { /* pause, pin, restart, shapes, trackers, sparse writes */ },
})
```

- **Rendering is cosmos.gl's.** `config` is cosmos.gl's `GraphConfig` minus the keys deck owns
  (`DECK_OWNED_CONFIG_KEYS`: the view and zoom, the frame loop, the pointer callbacks, the
  canvas). Every other key works as in cosmos.gl, rendering keys included; a key left out
  goes back to the engine default.
- **Colors** follow the deck.gl convention in accessors: RGBA channels in 0..255, converted
  for cosmos. Sizes and widths are in cosmos.gl's units (`scalePointsOnZoom`,
  `pointSizeScale`, `linkWidthScale`).
- **Binary styling**: in binary mode, `points.attributes` and `links.attributes` take typed
  arrays keyed by the accessor they replace — `getPointColor`, `getPointSize`, `getLinkColor`,
  `getLinkWidth`. A `Float32Array` is cosmos.gl's own form (colors in 0..1) and reaches the
  graph as it is, zero copies; a `Uint8Array` of 0..255 bytes is converted. Links then take
  the form `{ pairs, attributes }`; a bare pair array is `{ pairs }`. A new `points` or `links`
  object over the same positions or pairs restyles in place: the graph is reloaded only
  when the positions or the pairs themselves change.
- **The view.** cosmos.gl's view is a uniform scale and a translation with y up, so the
  layer draws under `OrthographicView({ flipY: false })` or a map view at pitch 0 and
  bearing 0 (see *On a map* in the Storybook docs). A rotated, pitched or y-down view is
  reported once in the console and not drawn.
- **Picking is deck's.** In deck's pick pass cosmos.gl draws its picking colors — an index
  per point and per link, hard-edged, dash gaps included — so `pickable` gives hover and
  click: `info.elementType` is `'point'` or `'link'`, `info.index` counts within that kind,
  and `info.object` is your original record for array data. `autoHighlight` lights the
  hovered point or link with cosmos.gl's own focus ring and focused-link width
  (`config.focusedPointRingColor`, `config.focusedLinkWidthIncrease`); deck's `highlightColor`
  is not used.
- **Dragging** (`enablePointDrag: true`, with `pickable`): a drag grabs the point — pinned on
  grab, moved with the pointer, released per `unpinOnDragEnd`; `dragReheatAlpha` restarts the
  simulation at a low alpha so the graph responds around the moving point. View panning is
  suppressed only while a point is grabbed. Works on a map as well.
- **Not yet**: a headless `Graph` applies data changes at once, so `transitions` and the
  transition keys of `config` have no effect; a host-driven transition clock is the next step.

### Driving the graph

The layer's `Graph` is yours to call — `onGraphCreated` hands it over, and
`onGraphDataLoaded` passes it with every load — except for what the layer does itself:

| Yours | The layer's |
|---|---|
| `setPointShapes`, `setLinkArrows`, `setLinkStyles`, `setLinkStrength`, `setPointClusters`, `setClusterPositions`, `setPinnedPoint(s)`, `start` / `pause` / `unpause`, `trackPointPositionsByIndices`, position reads, `setPointPosition` / `setPointPositionsByIndices` | `setPointPositions`, `setLinks`, `setPointColors`, `setPointSizes`, `setLinkColors`, `setLinkWidths`: loaded again whenever `points`, `links` or their accessors change |
| — | `config`: applied again whenever it changes, and `Graph.setConfig` resets what a new config leaves out, so set config through the prop |

The layer also steps the graph each frame while it runs (`pause()` it to step it yourself,
then `deck.redraw()` after each `step()`).

Arrays you send per point or per link follow the graph's indices, and a reload can move
them. `onGraphDataLoaded` fires after each load, once the graph holds the new data, and maps
your data to those indices: `pointIndexById` (with `getPointId`) and `links`, the array
links the graph holds in its order. Links whose endpoints name no point are dropped, so a
link's index can differ from its index in your array. Send per-point and per-link arrays
from there, and they line up:

```js
new CosmosGraphLayer({
  // …
  onGraphDataLoaded: ({ graph, pointsLoaded, linksLoaded, links }) => {
    if (pointsLoaded) graph.setPointShapes(Float32Array.from(nodes, (n) => SHAPES[n.kind]))
    if (linksLoaded && links) {
      graph.setLinkArrows(links.map((l) => l.directed))
      graph.setLinkStrength(Float32Array.from(links, (l) => l.weight))
    }
    graph.render() // applies what was set
  },
})
```

The engine reuses the last strength array it was sent whenever its length matches the link
count, so a new link set of the same length would pull with the old strengths in the old
order: send them again on every `linksLoaded`. The first call comes when the graph is ready,
later ones during deck's layer update: calls on the graph are fine in both, while changes to
layer props should wait.

Live examples: the *Integrations* section of the
[cosmos.gl Storybook](https://cosmosgl.github.io/graph).

## Bring your own graph

Pass a headless `Graph` you created through `graph` when the application needs to own it:
create it before the layer exists, keep it across layer removals, or drive it from
elsewhere in the app. It must run on deck's device. The layer steps it from deck's timeline
and draws it, but never configures or destroys it. `config` and `onGraphCreated` apply only
to a graph the layer creates.

`points` decides who loads the data. Leave it out and the layer draws whatever the graph
holds and writes nothing into it — not even the styling accessors: load and style the graph
yourself, before or after the layer exists, and the layout survives removing and re-adding
the layer. Give the layer `points` (and `links`) and it loads them into the graph, with its
accessors, over whatever it held, once the device check has passed.

```js
let deck
const devicePromise = new Promise((resolve) => {
  deck = new Deck({ /* … */, onDeviceInitialized: resolve, layers: [] })
})

// headless, on deck's device, never destroyed by cosmos; the application loads it
const graph = new Graph(null, config, devicePromise)
graph.setPointPositions(positions)
graph.setPointColors(colors) // cosmos's 0..1
graph.setLinks(links)
graph.render()

deck.setProps({
  // no `points`: the layer draws the graph as loaded
  layers: [new CosmosGraphLayer({ id: 'graph', graph })],
})

// Take over stepping: pause it, step it yourself, then ask deck to repaint
graph.pause()
graph.step()
deck.redraw()

// Teardown order matters: the device belongs to deck.
graph.destroy()
deck.finalize()
```

Several layers can draw one graph, say a main view and a minimap: it steps once per frame
however many layers draw it, as long as at most one of them carries `points`. Loading new
data never reheats: call `graph.start()` after `render()` when the simulation had settled.

## Your own renderer: `PositionTextureSource`

To draw the layout some other way — your own deck layers with deck's picking and attribute
pipeline, a Three.js material, a MapLibre custom layer — type your input against
`PositionTextureSource` from `@cosmos.gl/graph`. `Graph` and `GraphSimulation` both implement
it. `getPointPositionTexture()` returns a `PointPositionTexture`: point `i` lives at texel
`(i % textureSize, floor(i / textureSize))` as `[x, y, i, unused]`, an absent point reads as
NaN, and the handle changes as the simulation ping-pongs, so re-fetch it whenever `version`
changes.

The *Custom deck layers* story is the worked example: a standalone `GraphSimulation` on deck's
device, drawn by two deck layers of its own (`PointsLayer`, `LinksLayer` in the
story's sources) that `texelFetch` the texture by instance index — with binary attributes,
deck's attribute transitions and `highlightColor`, hover and a drag that pins the grabbed
point. They are example code, not package exports: copy them and make them yours.

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

- **WebGL 2 only** — cosmos.gl is WebGL-only; the layer throws an actionable error on a
  WebGPU device.
- **One luma.gl installation** — a `Device` shared across duplicate luma.gl copies is
  not a supported boundary; keep the peer versions aligned.
- **A flat, y-up view** — `OrthographicView({ flipY: false })`, or a map at pitch 0 and
  bearing 0. cosmos.gl's view cannot express pitch or bearing.

## License

MIT
