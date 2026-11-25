**WebGPU will replace WebGL in the production Graph.** Applications will continue to call `new Graph(container, config)`. WebGPU will be the sole runtime for both `Graph` and `GraphSimulation`. Support for the WebGL version ends at cutover.

During development, the Lab can keep loading the production WebGL build from the main workspace's `dist/index.min.js`. Build the WebGPU candidate separately and run the same Storybook stories against both packages. Once WebGPU passes the release checks, it takes over the main package and its build output. The last WebGL revision remains available for historical comparisons.

Default-force motion meets the measured slowdown margin for Karate Club and the two million-point community fixtures.
[Matched results](#/viewer-comparison?section=doc-migration-results) · [Performance rule](#/validation-workflow?section=performance-against-production-webgl)

## Current focus

```example
migrationFocus
```

**Compare both engines through Graph.** The packaged Lines cases exercise moving endpoints, thin strokes, styles and the wider click target. The force cases step identical inputs and read back each point. The earlier frozen-curve study records the pilot's one-device-pixel edge allowance. [Lines](#/production-lines?section=try-straight) · [Forces](#/production-forces?section=try-gravity) · [Curve pilot](#/curved-links?section=doc-automated-cases)

```example
youtubeMotion
```

The sample has 300,000 points and 300,000 links. The recorded Chrome 157 runs
used the same camera and measured simulation ticks 13–72.
[Live demo](#/youtube-network?section=try-friendships-300k)

## Production Graph API

The first milestone is a developer opening the same story twice and getting the same result from the same gesture. The last milestone is an application importing the published `@cosmos.gl/graph` and running entirely on WebGPU. Use the following sequence to get from one to the other.

### How to port a module

Use the WebGL module as the starting point. Follow its folder, name, responsibility and coding style wherever they fit. For a stateful force, prefer the corresponding class and make it easy to find where it prepares data, applies one step and releases resources. Preserve when configuration changes take effect and which positions the next force reads.

Keep a WebGPU-specific design when it has a concrete benefit. For example, a force can accept the current compute pass and position buffer explicitly so the simulation can schedule several forces in order and submit their work together. Either a class or a factory can own the persistent buffers.

When the implementations deliberately differ, record what WebGL does, what WebGPU does, why, and what an application can observe. Put the example and its check in the feature's Lab results and link it from the inventory. Changes that require application edits also belong in the public migration notes. [Collision grid sizing](#/production-force-collision?section=doc-results-collision-grid-sizing)

### Run the same story twice

Develop WebGPU in the private workspace package `experiments/graph-webgpu` on the same branch. Run the WebGL Storybook with `pnpm run storybook` on port 6006 and WebGPU with `pnpm run storybook:webgpu` on port 6007. Both read the same story files, assets and fixtures. The WebGPU preview resolves the public `@cosmos.gl/graph` import to the candidate entry. Each preview shows its engine and revision. The packed WebGPU Deck consumer runs separately on Deck 10 alpha.1 and luma alpha.14. The shared Deck stories still use the WebGL dependency family.

Start with the same WebGL build in both previews. Use a paused fixture with overlapping points, identical typed arrays, a fixed camera, viewport and pixel ratio. Check that both previews paint the same scene and a click returns the same foreground point. Generate data once for stories that use randomness. This establishes a repeatable comparison before the first WebGPU draw.

The **Manual step** story and `node scripts/check-storybook-pair.mjs` provide the first control on this branch. The check reads the actual canvas pixels, clicks both endpoints, steps gravity and opens Quick Start in each preview. Run it with both preview URLs set to the WebGL server to check the comparison setup itself.

### Draw and step a real WebGPU Graph

Point the second preview at the candidate. First draw two circles and one solid link through the usual constructor, setters and `render()`. Check the existing pattern of queuing setters and rendering before `ready` resolves. Resize, destroy and recreate the graph. Verify early that the candidate luma version supports compute, drawing and a borrowed WebGPU device.

Pin one endpoint, leave a third point slot absent, then advance one gravity step. Read the positions through the async public API and check that the link follows the free endpoint. Run the same step in a standalone `GraphSimulation`. The production frame loop owns scheduling. The force passes, renderer, picking and queries share the current GPU positions.

Keep data validation, configuration defaults and camera math shared. The candidate owns the device, buffers, compute and draw passes, and async readback. When an application supplies the device or a render pass, it retains ownership. A custom renderer can borrow the current position buffer for that frame. The package smoke test uses the standalone distribution so a working source alias cannot mask a broken build.

### Move the feature stories onto WebGPU

- **Data and layout.** Preserve indices, NaN absence, pins and force order through sparse edits, topology replacement, shrink and regrowth. Start with gravity, center, repulsion, weighted springs and cooling. Follow with mouse repulsion, clusters, attractors and collision. Check individual steps on small graphs and convergence on dense and hub graphs.
- **Drawing and picking.** Start with circles and solid straight links, then add solid curves with the production click target. Work through shape, image, stroke, ring, gradient, pattern, arrow and depth-order stories. Check the foreground object at overlaps, thin objects at fractional zoom and both pixel ratios in the [visual acceptance rules](#/validation-workflow?section=first-migration-rules).
- **Application behavior.** Run Quick Start, drag, pause/resume, Fit, resize, updates, transitions, callbacks, area selection and labels through the real story code. Define fresh async reads, any synchronous cache semantics and stale-result handling. Test releasing the pointer during a pick and replacing the graph during a selection.

Review each feature against the WebGL preview. Record intentional public API changes, such as migrating a host from the position texture to a borrowed position buffer. Track remaining differences in the feature inventory.

For each story, fix its inputs and capture the WebGL result, implement the public call on WebGPU, then replay the same gesture in both. Check data and IDs exactly. For images, check interiors, overlap and thin features at pixel ratios 1 and 2. The practical visual budget is one device pixel at a silhouette and two channel levels out of 255 in the interior. For moving layouts, check pins, absence, connectivity and convergence at fixed step counts. Preserve a small failing example when a difference needs further work.

### Compare the built packages in the Lab

Once both packages can run a scenario, load each built package in its own frame. Run the same application code and replay the same inputs. Start with fixed-position rendering and known overlapping IDs. Then compare fixed-tick simulation invariants, edits, selection and callback order. Keep using the existing prototype studies for their original questions.

In the packaged Lines replay, scrub a dashed endpoint across a pixel boundary and inspect the paint and the click target. In the small combined force replay, eight ticks move a gold link. Both packages drew and picked it at its new midpoint on M3 and SwiftShader, and the former midpoint returned background. [Endpoint motion](#/production-lines?section=try-endpoint-motion) · [Springs, repulsion and collision](#/production-forces?section=try-combined)

The packaged 8,192-slot dense and hub graphs kept the same community retention through tick 100. WebGPU had deeper residual overlaps in both. Both click comparisons met the native M3 margins. WebGPU's frame p95 stayed near 17.6 ms, and the WebGL controls varied enough to leave relative frame speed unassessed across two independent blocks. Larger graphs, deeper overlaps and moving selection remain open. [Dense communities](#/production-forces?section=try-dense) · [Hub](#/production-forces?section=try-hubs) · [Frame and click timings](#/production-forces?section=doc-scale-timing)

Extend packaged comparisons to million-point dense and hub graphs, data replacement, resize and memory use. The moving YouTube replay now records the camera and release positions, checks selected IDs and 1,000 tracked labels and measures the wait for a highlighted frame. Run timed comparisons one engine at a time, with repeated WebGL controls. Declare a slowdown margin before a release acceptance run. [Workloads and metrics](#/million-graph?section=doc-production-envelope) · [Moving YouTube replay](#/production-graph-api?section=doc-youtube-selection)

### Qualify and release the replacement

Exercise standalone Graph, headless simulation and the real `CosmosGraphLayer` on one supported luma family. Verify draw and pick in a host-owned pass, shared-device lifetime, initialization failure and recovery after device loss. Repeat the release scenarios on the supported browser and GPU range. Check the packaged builds, public types, Storybook and migration notes for async reads and custom host renderers.

At cutover, record the final WebGL revision and point historical comparisons to that build. Promote WebGPU to the main package and its normal distribution path. Publish Graph and the Deck integration in lockstep. The public Storybook then runs the WebGPU release, and the WebGL reference remains reproducible.

### Working candidate and remaining release checks

The same-branch candidate runs Quick Start and Manual step. Its browser tests cover resident simulation, input queued before initialization, pinned and absent slots, sparse edits, selection, label sampling, position and style transitions, and drawing and picking in a borrowed host pass. The real-package comparison lives in [Production Graph API](#/production-graph-api).

On M3, both packages returned exact rectangle IDs and 1,000 tracked coordinates on the moving 65,536-point YouTube graph. At one million points WebGPU returned exact results and WebGL's async queries timed out. Limiting queued frames and simplifying solid-link shading reduced feedback from 1.51–4.99 seconds to 0.46–0.90 seconds at the same four layout ticks. Earlier layouts still take longer. [Moving YouTube selection and labels](#/production-graph-api?section=doc-youtube-selection)

| Remaining check | Evidence needed before cutover |
| --- | --- |
| Force controls and layout quality | Above 4,096 points both engines now sample nearby points and group distant cells using the same quality settings. In the Lab's seeded replay of the 22,500-point lasso, initial expansion and late cluster motion closely matched on M3. A settled step and draw took 4.8 ms on WebGL and 1.9 ms on corrected WebGPU. Repeat on other adapters and quantify runtime and long-run overlap on dense and hub graphs. [Force comparisons](#/production-forces?section=doc-results) |
| Appearance across the catalog | Matched captures and picked IDs for every supported style, including moving curves, dashed curves, image alpha, hover and overlaps. Check animated insertion and removal, and selection during size transitions. |
| Interaction at scale | Compare visible feedback after release and label refresh on moving graphs. Profile channel uploads on highlight changes and report first request, p95 and stalls against repeated WebGL controls. |
| Public API and packages | Typecheck application and integration consumers against the packed release. Document fresh async reads, completed snapshots and the borrowed position buffer for custom renderers. |
| Deck and device recovery | The packed Deck layer passed drawing, picking, resize and teardown for both Graph ownership modes on M3. Restore a live user session on a replacement device, qualify the release dependencies and repeat across supported hardware and browsers. |

## What remains

- **Scope** The first paired run covers default forces and basic styles on native Chrome on M3. Repeat with production interaction styling and additional supported devices as integration proceeds. [Acceptance scope](#/million-graph?section=doc-production-envelope)
- **Moving performance** At one million points, frame p95 went from 151.4 to 67.0 ms for dense communities and from 151.7 to 68.5 ms in the hub confirmation. The largest YouTube run to complete the full benchmark workflow on both backends had 262,144 points. On the million-point YouTube graph, WebGL box selection hit its one-second timeout while earlier frames were still queued. The Lab WebGPU run completed all eight selections. Relative speed remains unassessed at that size. Investigate variable click times, including the earlier 68.2 and 100.4 ms pilot stalls. [Matched results](#/viewer-comparison?section=doc-migration-results) · [YouTube timeout](#/viewer-comparison?section=doc-migration-results-youtube-capacity)
- **Full simulation** All eight forces match recorded CPU checkpoints through 32,768 points. The resident approximation runs all eight through one million with exact link indices, pins and absence. Both million-point WebGPU layouts take about 267 ms p95. Compare the same force set with production WebGL. Profile collision where it causes a slowdown. Retest dense overlap, multiple hubs, adaptive sampling, cell crossings and long cooling at scale. [Full-force evidence](#/integrated-webgpu?section=doc-composed-interaction)
- **Appearance and picking** Moving circles and solid straight links match the checked interiors. Isolated shapes, images, rings, widths, gradients and patterned link studies still show some mask and color differences. Resolve visible ownership at edges and overlaps, then check arrows, hover, focus and depth-based occlusion in the same moving renderer. [Moving styles](#/viewer-comparison?section=doc-findings) · [Feature coverage](#feature-coverage)
- **Graph workflows** Both backends completed moving selection, 1,000 labels, updates and resize on the community fixtures. Resolve the two near-edge polygon discrepancies and verify these workflows through the full production WebGPU API. Transitions, callbacks, point dragging and Fit remain integration checks. [Readback evidence](#/integrated-webgpu?section=doc-readback) · [Matched results](#/viewer-comparison?section=doc-migration-results)
- **Deck, recovery and release** The packed WebGPU Graph and Deck layer now pass the same-device checks on M3. Next, recover a full session from unexpected WebGPU device loss. When WebGPU is unavailable or the host supplies an incompatible device, verify that `graph.ready` rejects with an actionable error and partial initialization releases its resources. The M3 controls cover current production WebGL and a Lab WebGPU restart. Extend the browser and GPU scope before public release. [Host evidence](#/integrated-webgpu?section=doc-host-ownership)

## Feature coverage

[Browse benchmarks and migration studies](#/?section=migration-studies)

```example
featureCoverage
```

## Parked investigations

Revisit these studies when the pilot exposes the issue or the feature enters scope. Review the retained failures before approving full migration.

- [Ordered prefetch for hubs](#/integrated-webgpu?section=doc-findings-star-bottleneck-and-one-bounded-candidate). The 8,192-point star misses timing. The newer three-hub runs quantify the spring cost at 16,384 and 32,768 points.
- [Straight-link caps and edges](#/straight-links?section=doc-automated-cases). Reopen exact-edge comparisons if thin links disappear, invisible links intercept picks or an outline shifts by more than one device pixel.
- [Dashed and dotted curves](#/curved-links?section=doc-case-evidence-archived-styles). Visible patterned curves still fail strict checks. Revisit gap picking, color and motion when patterns enter scope.
- [Fractional and polygon point edges](#/point-shapes?section=doc-method). Some masks and color-preserving alternatives fail. Resume if the circle pilot shows a defect or more shapes enter scope.
- [Faint-alpha picking](#/point-picking?section=doc-picking-evidence). The candidate fixes selected visibility cases at a cost under dense overlap. Resume if picking is wrong or slow, or images or translucent overlap enter scope.
- [Compute-generated ribbons](#/ribbon-generation?section=doc-findings). Keep the vertex path after the cost and color checks. Revisit if profiling shows curve generation is a substantial bottleneck.
- [Direct WebGL reset at 100,000 points](#/weighted-links?section=doc-context-loss). Bounded ordered passes now complete on M3. Revisit if the direct baseline is needed or the bounded path resets.
- [Collision seed parity](#/collision?section=doc-hashed-findings). The million-point resident path uses the Lab's deterministic seed stream. Recheck slot order and long dense runs with the production stream when the backend is integrated.

## Future directions

### Optional postprocessing package

**Exploratory idea, recorded 17 November 2026.** Let applications add soft glow,
fading trails and user-authored image effects through a separate package. Cosmos
would draw the graph into a GPU texture; the package would process that texture
and compose the displayed image without ordinary CPU image readback. Effect
shaders, temporary textures and effect ordering would belong to the optional
package. Its name and public API are undecided.

The first experiment should compare the unprocessed graph with reduced-resolution
glow and one custom shader. Check picking, transparent backgrounds, sharp edges,
resize/DPR changes and cleanup; measure added GPU time and memory at representative
viewport sizes. Decorative glow should preserve the original picking geometry;
effects that move pixels need an explicit picking policy. Selection-specific
effects need an additional mask or ID input.

Host-owned rendering can use the existing `drawToRenderPass` boundary. A convenient
attachment to the normal Graph loop still needs a render-target and composition
integration design. Previous-frame effects also need history invalidation and
frame scheduling. This idea is outside current migration acceptance scope and
does not establish an implementation commitment or a performance improvement.

### Named shader hooks and external effect packages

**Exploratory idea, recorded 17 November 2026.** Let an external package make
individual points pulse in brightness or give links custom shading during the
existing draw. Cosmos would expose named shader hooks and documented inputs;
extensions would supply shader snippets, typed parameters and optional resources.
Their code would be assembled into the drawing shaders only when enabled.
Postprocessing would remain a complementary way to process the resulting image.

Start with point/link RGB hooks that preserve opacity and geometry. A candidate
point hook would run after base-color transitions and before greyout/hover
styling. Extension ordering, color space, input types and coordinate units need
explicit contracts. Shape, size, opacity and display-position hooks would need
separate picking, selection, bounds and culling contracts before acceptance.

The following is a proposed API sketch, not an available export or configuration:

```ts
const pulse = createShaderExtension({
  id: 'pulse',
  animated: true,
  uniforms: { speed: { type: 'f32', value: 2.0 } },
  hooks: {
    'point:rgb': {
      glsl: `
        float phase = frame.time * effect.speed + float(point.index) * 0.2;
        rgb *= 0.85 + 0.15 * sin(phase);
      `,
    },
  },
})
// Proposed attachment: new Graph(container, { extensions: [pulse] })
// Proposed parameter update: pulse.setUniforms({ speed: 4.0 })
```

Cosmos would supply mutable RGB, a read-only point index and elapsed time in
seconds, and generate the parameter bindings. Authors targeting both backends
would provide GLSL and WGSL implementations; missing backend support should report
an actionable error. A packaged factory could expose only options such as speed
to application users. The example declares animation so rendering can continue
while the layout is paused.

The first prototype should demonstrate a static tint and animated RGB pulse.
Verify unchanged output when disabled, transitions and interaction styling,
picking, deterministic extension composition, parameter updates without shader
recompilation, compilation diagnostics, per-graph isolation and cleanup. Measure
added GPU cost and confirm animation stops scheduling frames when removed. Use
public APIs in the pinned luma version; source assembly alone is not a rendered
prototype. This idea is outside current migration acceptance scope; API names,
package boundaries and implementation timing remain undecided.
