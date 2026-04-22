# Migration Guide

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
import { GraphConfig } from '@cosmograph/cosmos'
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

You can track transition lifecycle via:
- `onTransitionStart`
- `onTransition` (eased progress in `[0, 1]`)
- `onTransitionEnd` (`interrupted: boolean`)

#### Simulation and Rendering Are Now Separate

- `render()` — starts the render loop only; it no longer restarts the simulation.
- `start()` — resets and begins the simulation (alpha, progress, running state) without starting the render loop. Call `render()` separately to begin drawing.
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
