<!-- suggested path: history/2026/2026-08-18-host-embedding.md -->

# Host embedding: headless mode, external scheduling, GPU position sharing

**Commits:** `feat(graph): headless mode and external frame scheduling`
(`8598b4b`), `feat(points): expose GPU positions — texture handle, non-stalling
snapshots, sparse writes, per-point pinning` (`3387937`), `feat(graph): render
into a host pass with a host camera — drawToRenderPass and setViewTransform`
(`6db7229`), `fix(graph): reset ambient GL state before passes on an external
device` (`25c246b`), `feat(stories): deck.gl integration examples`
(`b4211b0`), `build(deps): make luma.gl a peer dependency` (`119688f`),
`feat(simulation): extract GraphSimulation` (`c8fa3f6`), `feat(stories): run
the zero-copy story on GraphSimulation` (`0fda0ef`), `feat(api): rename
setPointPinned to setPinnedPoint` (`765154b`), `feat(api): sanitize the pinned
set and add isPointPinned` (`f11b9b5`), `test: host-embedding unit tests on
real WebGL 2` (`c658e2f`), `fix(points): fence the async position read`
(`af35256`), `fix(simulation): defer stop() until the device is ready`
(`2ac47d0`), `fix(points): the async snapshot detects a point-count change
mid-flight` (`e51befe`), `fix(points): a sparse write holds through a position
transition` (`9b3e9d8`)

## Why

An RFC in deck.gl-community proposes a `cosmos-layers` package backed by
cosmos.gl, and
gates a production integration on upstream changes: a simulation that runs
without owning a canvas, a render loop that a host scheduler can replace, and
GPU position access that doesn't round-trip through the CPU. This change
implements the two roadmap milestones that unblock that work — headless
operation and external scheduling, plus the read/write APIs a host needs
(position texture, efficient snapshots, sparse updates, pinning) — and, once
the unit tests could act as a safety net, the `GraphSimulation` class
extraction those APIs were designed toward (see below).

## New capabilities

**Headless mode** — `new Graph(null, config, devicePromise?)`. Without a `div`,
the instance is simulation-only: no canvas is adopted, styled, or reparented; no
zoom/drag/pointer/keyboard listeners are installed; no internal frames are ever
scheduled; and an externally supplied device is never cleared, submitted,
resized, or reparented. Transitions snap (nothing would advance them), and
view-dependent APIs are inert. Works with an internal device too (`new
Graph(null, config)`) — the device renders to a detached canvas, which is
exactly the "hidden layout engine" pattern the RFC's Phase-1 `CosmosLayout`
needs.

**External scheduling** — `enableRenderLoop: false` keeps a non-headless
instance from scheduling `requestAnimationFrame`; the host calls `step()` to
advance the simulation and the new `renderOneFrame()` to draw. The
simulation-end check (`alpha < ALPHA_MIN` → `onSimulationEnd`) that the internal
loop used to perform now also runs from `step()` when no loop exists, so a
host-driven simulation still terminates.

**GPU position sharing** — `getPointPositionTexture()` returns
`{ texture, pointCount, textureSize, version }`. The texel contract is
documented on the exported `PointPositionTexture` type: square RGBA32F, point
`i` at `(i % size, i / size)` as `[x, y, i, unused]`. The handle alternates
between two ping-pong textures every simulation write, so consumers re-fetch
when `version` changes rather than caching the texture object.

**Host render pass** — `drawToRenderPass(renderPass, {points?, links?})`
records the point/link draws into a host-owned pass without clearing, ending,
or submitting it. The internal `renderFrame()` now routes through it.

**Host view injection** — `setViewTransform({k, x, y}, screenSize?)` sets the
view directly, bypassing the interactive zoom behavior. It routes through the
same `Zoom.applyEventTransform()` the d3-zoom `'zoom'` handler uses, so every
view consumer stays consistent: the shader projection matrix, picking, radius
zoom-scaling, and the space↔screen conversions. This is what makes
`drawToRenderPass` usable from a deck.gl layer: the layer converts deck's
viewport into cosmos's `{k, x, y}` convention each draw (the JSDoc states the
exact space→screen formula to invert), and cosmos's full rendering — per-point
shapes/colors/sizes, per-link colors/widths, curved links, arrows — projects
with the host's camera. It answers the RFC's open question 3 with "both":
expose the position texture *and* let a host drive cosmos's own draw programs.
One constraint: the d3 transform's uniform positive scale means space y is
always up, so a deck view embedding cosmos rendering uses
`OrthographicView({flipY: false})`.

**Snapshots** — `getPointPositionsArray(out?)` (Float32Array, optional caller
destination) and `getPointPositionsAsync(out?)` (staging-buffer copy +
fence-based read; no GPU stall). `getPointPositions()` docs now state that it
stalls, and it delegates to the array variant. The async read waits behind a
fence before it touches the buffer, and resolves empty when the data was
rebuilt during the wait: it compares the point count as well as the texture
size, because counts such as 3 and 4 share one texture.

**Sparse updates and pinning** — `setPointPosition(index, x, y)` /
`setPointPositionsByIndices(indices, positions)` write one texel per point into
the live position texture (the drag pattern, generalized — input arrays are
untouched, so a data rebuild starts from the inputs again), and
`setPinnedPoint(index, pinned)` flips one point's pin with a one-texel write
instead of `setPinnedPoints`' full-texture rebuild. Together they map a host's
drag interaction onto a running simulation.

A sparse write also has to hold through a position transition. On a graph
that animates `setPointPositions`, the transition does not read the live
texture: every frame it redraws it from its own source and target textures, so
a point a host moved was back on the animation one frame later. While a
position transition is queued or active, the write goes into those two
textures as well. Both sides of the blend then hold the host's coordinate, the
other points still run to their targets, and `onTransitionEnd` reports a
normal completion. Two alternatives were turned down:

- **Ending the transition before the write**, as `start()` and `unpause()` do.
  They can, because the simulation then moves every point. A sparse write
  hands the other points to nobody: `render()` leaves the simulation paused
  after a position transition, so they would stay on the frame they stopped
  on and the layout the application asked for would never arrive.
- **Checking only for an active transition.** `render()` builds the textures
  before the cycle becomes active, and `onSimulationPause` and an interrupting
  `onTransitionEnd(true)` run in between, so a queued transition counts too.

Two rules stay as they were. An absent point is skipped, so a write cannot
bring back a point that is fading out. And a write made before the `render()`
that applies new positions is replaced by that data update, animated or not:
the input arrays are untouched, and a data rebuild starts from them.

The pin surface was aligned before the stable 3.5.0 lands (a beta-line-only
break: 3.5.0-beta.1 exported the method as `setPointPinned`). The sparse method
is named `setPinnedPoint` so the pair follows the convention the position
family already teaches — same stem, plural = bulk set, singular = one-element
live write. `setPinnedPoints` now stores a sanitized copy of the caller's
array: entries that can never name a point (negative, non-integer) are
dropped, duplicates collapse, and mutating the array afterwards no longer
leaks into pin state; indices at or beyond the current point count are kept
and take effect if the count grows — the tracking API's behavior, deliberately
left undocumented so it stays behavior rather than contract. `isPointPinned(index)`
is the read side: a host that pins during a drag gesture can restore a
deliberate pin on release instead of blindly unpinning. A list getter was
considered and dropped — additive API is forever, and the boolean can't be
misused as a per-frame hot path.

## The shared-device state bug

Verifying the zero-copy story surfaced a real bug that would have broken every
shared-device embedding: **cosmos's offscreen passes inherited the host's
ambient GL state.** luma applies only the pipeline `parameters` a Model
declares; cosmos's simulation models declare none, which is safe on cosmos's
own device (WebGL defaults) but not on a device that arrives mid-frame with the
host's state. deck.gl leaves blending enabled — and a blended write into the
RGBA32F position texture, whose texels carry alpha 0, zeroes the whole
simulation: every point index channel became 0 and the layout collapsed into
the space corner. The fix is `resetExternalDeviceState()` at the top of
`runSimulationStep()` / `renderFrame()`: for externally supplied devices it
resets blend, depth, scissor, stencil, cull, and color mask through luma's
tracked `setParametersWebGL`. Cosmos-owned devices skip it, keeping existing
behavior byte-identical.

The draws that run between steps were found later, one consumer at a time,
and reset the state the same way: the tracking draw after a sparse write
(`fix(simulation): reset host GL state before sparse-write tracking draws`,
`8fc0288`), then a tracker's gather wherever it is reached from and a cluster
read's own pass (`feat(points): point trackers`, `58f4afe`; see
[non-blocking position reads](2026-09-28-nonblocking-position-reads.md)).

Verified on a shared deck.gl device: 100 steps interleaved with deck redraws
keep all 10,000 index channels intact, and pin + sparse-move + step holds the
point exactly.

## Example

The three stories below were this milestone's examples. The first became
`CosmosGraphLayer`, and the other two retired when the stories moved into the
deck-side package and were focused on the layer; the current set is described
in [deck-layers](2026-09-07-deck-layers.md).

`src/stories/integrations/` (Storybook: **Examples/Integrations**), with
`@deck.gl/core` + `@deck.gl/layers` `~9.3.0` as devDependencies — deck 9.3
resolves to the same `@luma.gl/core@9.3.6` as cosmos, so one deduped copy
serves both (a shared `Device` across two luma copies is not a supported
boundary).

- **deck.gl: shared device, zero-copy** — deck owns the canvas, device, and
  frame lifecycle; a standalone `GraphSimulation` runs on deck's device,
  advanced one `step()` per frame from `onBeforeRender`; custom layers render
  points and links by `texelFetch`ing the live position texture
  (`cosmos-deck-layers.ts`). Positions never leave the GPU.
- **deck.gl: cosmos rendering in a deck layer** — same shared-device setup, but
  the layer calls `setViewTransform` + `drawToRenderPass` so cosmos's own draw
  programs render everything (cluster colors, per-point sizes, curved
  per-link-colored links) under deck's camera. No custom shaders at all.
- **deck.gl: CPU readback layout** — headless cosmos as a pure layout engine
  feeding stock `ScatterplotLayer`/`LineLayer` through throttled
  `getPointPositionsAsync()` snapshots (the RFC's Phase-1 `CosmosLayout`
  pattern).

## The `GraphSimulation` extraction

`GraphSimulation` (exported, `src/simulation.ts`) is the simulation as a
standalone class: device ownership, the data model, the position engine
(`Points`), the force modules, clusters, the step pipeline with alpha decay and
end detection, all the ingest setters (positions, links, sizes, clusters,
pinning, sparse writes), `applyData()` as the render()-counterpart, and the
three position outputs, since joined by point trackers. `Graph` now
**composes** it — it creates the simulation,
shares one config object with it, aliases its store/data/points internally, and
layers rendering, view state, transitions, and input on top. The interaction
context (right-click repulsion, zoom-suspends-forces) threads into
`runSimulationStep(force, {applyMouseRepulsion, blockedByInteraction})` instead
of being read from controllers the simulation no longer knows about.

Boundaries chosen deliberately:

- **`Points` is not split.** It still carries both the simulation resources and
  the draw programs; the simulation owns it and `Graph` reaches in for
  rendering. Splitting it (a `PointSimulation` vs. a renderer) is the remaining
  internal debt — a standalone `GraphSimulation` compiles draw shaders it never
  uses. The public boundary doesn't change when that lands.
- **`Store` is shared, not split.** Engine state (alpha, texture sizes) and view
  state (screen size, transform) live in one internal object both halves see.
- **Config is `Pick`ed, not duplicated**: `GraphSimulationConfigInterface`
  selects the simulation keys from `GraphConfigInterface` (plus
  `pointDefaultSize`, which the collision force derives radii from), so the
  option docs exist once.

The extraction also closed a latent init race: `Graph.isReady` used to flip
true before the modules existed (a `setPointPositions` call landing in the
canvas-measurement window could hit undefined `points`); it now flips after
the module aliases are wired.

The standalone class is covered by its own test file
(`test/graph-simulation.test.ts` — lifecycle, links, texture contract,
pinning, `setConfig` enable/disable, external-device state safety), and the
zero-copy deck.gl story now uses `GraphSimulation` directly instead of a
headless `Graph`.

## Packaging

`@luma.gl/*` moved from dependencies to peerDependencies (compatibility range
`~9.3.0`, narrowed from a caret range: deck.gl 9.3 takes luma.gl with a caret of
its own, luma.gl's packages hold the 9.3 line through their peers, and with a
caret here a package manager placed luma.gl 9.4 next to deck's 9.3 copy), so
the application owns the single luma.gl installation that cosmos.gl, deck.gl,
and everything else share. The ES build keeps luma.gl
external (bundling a private copy would defeat the contract); the UMD build
stays standalone for CDN use. Pinned `~9.3.6` versions, in the workspace
catalog since the repo became one, keep the repo's own toolchain
deterministic. Breaking for package managers that don't
auto-install peers — see `migration-notes.md`. Stable luma.gl 9.4 shipped on
2026-09-05 and sits outside the range on purpose. The engine passes its own
tests on it, so the tilde is policy, not compatibility: with a caret npm placed
9.4 beside deck 9.3's own 9.3.6, two copies. The deck layers pin deck.gl to the
same line for a different reason: they fail on deck.gl 9.4. Widening either
range is a verified release, never automatic.

## Notes

- The Browser-pane verification quirk applies doubly here: deck's animation
  loop is also rAF-driven, so in a hidden pane neither engine advances. The
  stories were verified by shimming `requestAnimationFrame` with a
  MessageChannel pump in the preview iframe.
