# Migration Guide

## Migrating `@cosmos.gl/deck-layers` past 3.5

### `CosmosGraphLayer` Draws With cosmos.gl's Renderer

The layer no longer renders through sublayers of its own. It owns a headless
`Graph` on deck's device and lets cosmos.gl's renderer draw into deck's render
pass under deck's camera, so every cosmos.gl rendering option works through
`config`. This changes the layer's API:

| Before (3.5) | Now |
|---|---|
| `simulationConfig: GraphSimulationConfig` | `config: CosmosGraphLayerConfig` — cosmos.gl's `GraphConfig` minus the keys deck owns (`DECK_OWNED_CONFIG_KEYS`). Rendering keys work. |
| `simulation: GraphSimulation` (provided) | `graph: Graph` — a headless `new Graph(null, config, devicePromise)` on deck's device |
| `onSimulationCreated(simulation)` | `onGraphCreated(graph)` |
| `pointSizeUnits`, `linkWidthUnits` | removed — sizes are cosmos.gl's (`scalePointsOnZoom`, `pointSizeScale`, `linkWidthScale`) |
| `autoHighlight` with `highlightColor` | `autoHighlight` lights the hovered element with cosmos.gl's hover ring / hovered-link width; `highlightColor` is not used — set `config.hoveredPointRingColor`, `config.hoveredLinkColor` |
| `enablePointDrag` on a map | works now: the drag goes through cosmos.gl's own screen → space inverse |
| `transitions` on accessors | no effect — a headless `Graph` applies changes at once |
| `getPointColor` / `getLinkColor` defaults `[74, 92, 191, 230]` / `[94, 115, 194, 64]` | no default: an accessor left out draws `config.pointDefaultColor` / `config.linkDefaultColor`, cosmos.gl's grey `#b3b3b3` / `#666666` unless set. For the old colors, set `pointDefaultColor: 'rgba(74, 92, 191, 0.9)'` and `linkDefaultColor: 'rgba(94, 115, 194, 0.25)'`. Sizes and widths keep their defaults (4, 1). |
| `_subLayerProps`, `highlightedObjectIndex` | no sublayers to address |
| `OrthographicView()` | `OrthographicView({ flipY: false })` — cosmos.gl's space has y up; a y-down, rotated or pitched view is reported once and not drawn. Map views work at pitch 0 and bearing 0. |

Binary attributes: a `Float32Array` color channel is now cosmos.gl's 0..1 and is handed
over as it is (zero copies); `Uint8Array` 0..255 bytes are converted as before.

New: `onGraphDataLoaded(info)` fires after each load of `points` or `links` with the graph,
what the load replaced, the id→index map and the array links in the graph's order — the
place to send per-point and per-link arrays (`setPointShapes`, `setLinkStrength`, …) so they
line up with the graph's indices.

```js
// before
new CosmosGraphLayer({
  id: 'graph', points, links,
  simulationConfig: { simulationGravity: 0.25 },
  onSimulationCreated: (simulation) => { /* … */ },
  pickable: true, autoHighlight: true, enablePointDrag: true,
})

// now
new CosmosGraphLayer({
  id: 'graph', points, links,
  config: { simulationGravity: 0.25, curvedLinks: true, pointDefaultShape: PointShape.Hexagon },
  onGraphCreated: (graph) => { /* … */ },
})
```

Picking, hover and click are unchanged in use: `pickable`, `onHover` / `onClick`,
`info.elementType`, `info.index` and `info.object` work as before — cosmos.gl draws its picking
colors in deck's pick pass. The *Custom deck layers* story carries the former sublayers as a
starting point for a renderer of your own over `PositionTextureSource`.

## Migrating to v3.5

### luma.gl Is Now a Peer Dependency

The `@luma.gl/*` packages (`core`, `engine`, `shadertools`, `webgl`) moved from
`dependencies` to `peerDependencies`, with a documented compatibility range of
`~9.3.0`. This lets cosmos.gl and a host application (for example deck.gl)
resolve **one** luma.gl installation — a GPU `Device` shared between two
independently installed luma.gl copies is not a supported boundary, and the
public types no longer force casts between two copies of `Device`.

The range names the 9.3 line on purpose. deck.gl 9.3 takes luma.gl with a caret
range of its own, which admits 9.4; the 9.3 line is held by luma.gl itself
(`@luma.gl/engine` 9.3.6 peers `@luma.gl/core` at `~9.3.0`). With a caret range
here, npm placed luma.gl 9.4 next to deck's 9.3 copy — two copies, and a broken
shared device — without any error. The range widens when cosmos.gl is verified
on a newer line, as a release.

What you need to do:

- **npm 7+**: nothing — npm installs peer dependencies automatically.
- **Yarn, or pnpm configured without auto-install-peers**: add luma.gl
  explicitly alongside cosmos.gl, at the range — a bare install gets the latest
  luma.gl, which is outside it:

```bash
yarn add @cosmos.gl/graph @luma.gl/core@~9.3.0 @luma.gl/engine@~9.3.0 @luma.gl/shadertools@~9.3.0 @luma.gl/webgl@~9.3.0
# or
pnpm add @cosmos.gl/graph @luma.gl/core@~9.3.0 @luma.gl/engine@~9.3.0 @luma.gl/shadertools@~9.3.0 @luma.gl/webgl@~9.3.0
```

- **CDN / UMD users**: nothing — `dist/index.min.js` still bundles luma.gl and
  stays standalone.

If your application also depends on luma.gl directly (or through deck.gl),
make sure everything resolves inside `~9.3.0` — check with:

```bash
npm ls @luma.gl/core
```

## Migrating to v3.0

Version 3.0 is largely compatible with the existing v2 API — your core setup code (`new Graph(div, config)`, `setPointPositions()`, `setLinks()`, `setConfig()`, `render()`) continues to work as before. The underlying rendering engine has been ported from [regl](https://github.com/regl-project/regl) to [luma.gl](https://luma.gl/) (WebGL 2), but this is mostly an internal change. The breaking changes are limited to a handful of renamed config options, methods, and adjusted defaults listed below.

### Breaking Changes

#### Removed Deprecated Config Options

The following config options were deprecated in v2 and have been fully removed in v3. Use the new names instead:

| Deprecated (v2) | Replacement (v3) |
|---|---|
| `pointColor` | `pointDefaultColor` |
| `pointSize` | `pointDefaultSize` |
| `linkColor` | `linkDefaultColor` |
| `linkWidth` | `linkDefaultWidth` |
| `linkArrows` | `linkDefaultArrows` |

```ts
// Before (deprecated in v2, removed in v3)
const config = {
  pointColor: '#b3b3b3',
  pointSize: 4,
  linkColor: '#666666',
  linkWidth: 1,
  linkArrows: false,
}

// After (v3)
const config = {
  pointDefaultColor: '#b3b3b3',
  pointDefaultSize: 4,
  linkDefaultColor: '#666666',
  linkDefaultWidth: 1,
  linkDefaultArrows: false,
}
```

#### Removed Deprecated Methods and Callbacks

The following methods and callbacks were deprecated in v2 and have been fully removed in v3:

| Deprecated (v2) | Replacement (v3) |
|---|---|
| `restart()` | `unpause()` |
| `getPointsInRange()` | `findPointsInRect(rect)` |
| `selectPointsInRange()` | `findPointsInRect(rect)` then `setConfigPartial({ highlightedPointIndices })` |
| `onSimulationRestart` callback | `onSimulationUnpause` |

#### Color Tuple Range Is Now Strictly Normalized (`0..1`)

RGBA tuple config values now use normalized channel values only:
- Old (v2-style): `[r, g, b, a]` with RGB in `0..255`
- New (v3): `[r, g, b, a]` with all channels in `0..1`

This applies to tuple-based color config values such as:
- `backgroundColor`
- `pointDefaultColor`
- `pointGreyoutColor`
- `hoveredPointRingColor`
- `focusedPointRingColor`
- `outlinedPointRingColor`
- `linkDefaultColor`
- `hoveredLinkColor`

If your app passes tuples with RGB in `0..255`, convert them before passing to graph config:

```ts
const toNormalizedRgba = ([r, g, b, a]: [number, number, number, number]): [number, number, number, number] => [
  r / 255,
  g / 255,
  b / 255,
  a,
]
```

#### Renamed Methods

The following methods have been renamed in v3. Their signatures have also changed — see the API reference for details.

| v2 | v3 | Notes |
|---|---|---|
| `getAdjacentIndices(index)` | `getNeighboringPointIndices(pointIndices)` | Now accepts `number \| number[]`, returns deduplicated `number[]` |
| `getPointsInRect(selection)` | `findPointsInRect(rect)` | Now returns `number[]` instead of `Float32Array`. Must be called after `await graph.ready` |
| `getPointsInPolygon(polygonPath)` | `findPointsInPolygon(polygonPath)` | Now returns `number[]` instead of `Float32Array`. Must be called after `await graph.ready` |

#### Selection Replaced by Config-Driven Highlighting and Outlining

The method-based selection API has been removed. Point and link visual states are now controlled through config properties via `setConfig()` or `setConfigPartial()` (prefer `setConfigPartial()` to avoid resetting other fields):

**Removed methods:**
- `selectPointByIndex()` / `selectPointsByIndices()` — use `setConfigPartial({ highlightedPointIndices })` instead
- `selectPointsInRect()` — use `findPointsInRect()` then `setConfigPartial({ highlightedPointIndices })` instead
- `selectPointsInPolygon()` — use `findPointsInPolygon()` then `setConfigPartial({ highlightedPointIndices })` instead
- `unselectPoints()` — use `setConfigPartial({ highlightedPointIndices: undefined, highlightedLinkIndices: undefined })` instead
- `getSelectedIndices()` — track highlighted indices in your own state

**New config properties for points:**
- `highlightedPointIndices` — array of point indices to highlight (`[]` = all greyed, `undefined` = no highlighting)
- `outlinedPointIndices` — array of point indices to render with an outline ring
- `outlinedPointRingColor` — color of the outline ring (default: `'white'`)

**New config properties for links:**
- `highlightedLinkIndices` — array of link indices to highlight (`[]` = all greyed, `undefined` = no highlighting)
- `focusedLinkIndex` — index of a single focused link (renders wider)
- `focusedLinkWidthIncrease` — extra pixels added to focused link width (default: `5`)

**New methods:**
- `getConnectedLinkIndices(pointIndices)` — returns link indices where both endpoints are in the given point set
- `getConnectedPointIndices(linkIndices)` — returns point indices at the endpoints of the given links

**Key differences from v2:**
- Point and link highlighting are independent — greying out points does not grey out links automatically
- `[]` and `undefined` have different meanings: `[]` activates highlighting with everything greyed, `undefined` clears highlighting entirely
- `getConnectedLinkIndices()` only returns links where both source and target are in the provided set

```ts
// Before (v2)
graph.selectPointsByIndices([0, 1, 2])

// After (v3)
graph.setConfigPartial({
  highlightedPointIndices: [0, 1, 2],
  highlightedLinkIndices: graph.getConnectedLinkIndices([0, 1, 2]),
})

// Clear highlighting
graph.setConfigPartial({
  highlightedPointIndices: undefined,
  highlightedLinkIndices: undefined,
})
```

#### Removed Config Options

These options have been removed with no replacement:
- `useClassicQuadtree`
- `simulationRepulsionQuadtreeLevels`

#### Changed Defaults

- **`spaceSize`**: `8192` → `4096` — values above `4096` can crash the graph on iOS.
- **`pixelRatio`**: `2` → `window.devicePixelRatio || 2` — the canvas now matches the display's native pixel ratio by default, which may change rendering quality and GPU memory usage.

#### `setConfig` Now Resets to Defaults

`setConfig()` now fully resets the configuration to default values before applying the provided properties. Any omitted properties will revert to their defaults rather than retaining their previous values.

Use the new `setConfigPartial()` method to update only specific properties while keeping everything else unchanged.

```ts
// setConfig resets all values to defaults, then applies the provided ones
graph.setConfig({ simulationRepulsion: 0.5 }) // ⚠️ all other config values reset

// setConfigPartial only updates the provided properties
graph.setConfigPartial({ simulationRepulsion: 0.5 }) // ✅ other values preserved
```

#### `GraphConfigInterface` Is No Longer Exported

`GraphConfigInterface` is no longer exported from the package. Use `GraphConfig` instead.

```ts
// Before (v2)
import { GraphConfigInterface } from '@cosmograph/cosmos'
const config: GraphConfigInterface = { /* ... */ }

// After (v3)
import { GraphConfig } from '@cosmos.gl/graph'
const config: GraphConfig = { /* ... */ }
```

#### Init-Only Config Fields

The following config properties can only be set during initialization (via `new Graph(div, config)`) and are ignored by `setConfig()` and `setConfigPartial()`:

- `initialZoomLevel`
- `randomSeed`
- `attribution`

`enableSimulation` is runtime-switchable in v3 and can be changed via `setConfig()` and `setConfigPartial()`.

#### Transitions Enabled by Default

`transitionDuration` is a new config property in v3, and its default is `800`. Because of that, after the first render, updates such as `setPointPositions(...); render()` animate instead of snapping immediately.

To preserve snap behavior from earlier versions, set:

```ts
const graph = new Graph(div, {
  transitionDuration: 0,
})
```

Or disable transitions for a single update cycle:

```ts
graph.setConfigPartial({ transitionDuration: 0 })
graph.setPointPositions(nextPositions)
graph.render()
graph.setConfigPartial({ transitionDuration: 800 })
```

**Auto-pause.** When a position transition runs while the simulation is on, the simulation auto-pauses for the transition and **stays paused afterwards**. Call `graph.unpause()` to resume forces. Set `transitionDuration: 0` to keep the v2 snap-and-keep-running behavior.

You can track transition lifecycle via:
- `onTransitionStart`
- `onTransition` (eased progress in `[0, 1]`)
- `onTransitionEnd` (`interrupted: boolean`)

#### Simulation and Rendering Are Now Separate

- `render()` — starts the render loop only; it no longer restarts the simulation.
- `start()` — resets and begins the simulation (alpha, progress, running state) without starting the render loop. Call `render()` separately to begin drawing. Calling `start(alpha)` while the simulation is already running **reheats** it (resets alpha and progress) without firing `onSimulationStart` again.
- `step()` — runs exactly one simulation tick, leaving the running state untouched. Previously, this also paused the simulation.

#### Async Initialization

Initialization is now fully asynchronous — the constructor returns immediately. You don't need to change your setup code since all public methods (`setConfig`, `setPointPositions`, `setLinks`, etc.) automatically queue until the device is ready. But if you need to read data back (like `getPointPositions()`), wait for initialization to complete first:

```ts
const graph = new Graph(div, config)
graph.setPointPositions(positions) // safe to call immediately, will be queued
graph.render()                     // safe to call immediately, will be queued

// Wait before reading data back
await graph.ready
const currentPositions = graph.getPointPositions()

// Or check synchronously:
if (graph.isReady) {
  const currentPositions = graph.getPointPositions()
}
```

### Fixes

- **Fixed `rescalePositions` centering** — nodes are now placed in the center of the simulation space instead of the bottom-left corner.

---

## Migrating to v2.0

### Introduction

Welcome to the updated cosmos.gl library! Version 2.0 introduces significant improvements in data handling and performance, marking a major milestone for the library. This guide will help you transition to the new version smoothly.

### Key Changes in Data Handling

This update is centered on enhancing data performance by utilizing formats directly compatible with WebGL. Since WebGL operates with buffers and framebuffers created from arrays of numbers, we have introduced new methods to handle data more efficiently.

### Replacing `setData`

The `setData` method has been replaced with `setPointPositions` and `setLinks`. These new methods accept `Float32Array`, which are directly used to create WebGL textures.

**Before:**
```ts
graph.setData(
  [{ id: 'a' }, { id: 'b' }], // Nodes
  [{ source: 'a', target: 'b' }] // Links
);
```

**After:**
```ts
graph.setPointPositions(new Float32Array([
  400, 400, // x and y of the first point
  500, 500, // x and y of the second point
]));
graph.setLinks(new Float32Array([
  0, 1 // Link between the first and second point
]));
```

### Configuration Updates

Accessor functions for styling such as `nodeColor`, `nodeSize`, `linkColor`, `linkWidth`, and `linkArrows`, have been eliminated. You can now set these attributes directly using `Float32Array`.

**Before:**
```ts
config.nodeColor = node => node.color;
```

**After:**
```ts
graph.setPointColors(new Float32Array([
  0.5, 0.5, 1, 1, // r, g, b, alpha for the first point
  0.5, 1, 0.5, 1, // r, g, b, alpha for the second point
]));
```

### Flat Configuration Object

The configuration object is now flat instead of nested.

**Before:**
```ts
const config = {
  backgroundColor: 'black',
  simulation: {
    repulsion: 0.5,
  },
  events: {
    onNodeMouseOver: (node, index, pos) => console.log(`Hovered over node ${node.id}`)
  }
}
```

**After:**
```ts
const config = {
  backgroundColor: 'black',
  simulationRepulsion: 0.5,
  onPointMouseOver: (index, pos) => console.log(`Hovered over point at index ${index}`),
}
```

### Initialization Change: From Canvas to Div

In version 2.0, the initialization of the graph now requires a `div` element instead of a `canvas` element.

**Before:**
```ts
const canvas = document.getElementById('myCanvas')
const graph = new Graph(canvas, config)
```

**After:**
```ts
const div = document.getElementById('myDiv')
const graph = new Graph(div, config)
```

### Additional Changes

- **Terminology Update:** "Node" is now "Point," but "Link" remains unchanged.
- **API Modifications:** All methods that focused on node objects have been updated or replaced to handle indices.
- **Manual Rendering:** After setting data or updating point/link properties, remember to run `graph.render()` to update WebGL textures and render the graph with the new data.
