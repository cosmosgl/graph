**WebGPU will replace WebGL in the production Graph.** Applications will continue to call `new Graph(container, config)`. WebGPU will be the sole runtime for both `Graph` and `GraphSimulation`. Support for the WebGL version ends at cutover.

During development, the Lab can keep loading the production WebGL build from the main workspace's `dist/index.min.js`. Build the WebGPU candidate separately and run the same Storybook stories against both packages. Once WebGPU passes the release checks, it takes over the main package and its build output. The last WebGL revision remains available for historical comparisons.

Both built packages passed the million-point dense and hub layout checks on Apple M3. Two WebGL controls provide a baseline at nine fixed ticks. With all eight forces active, the largest RMS position difference was under 0.256% of the WebGL layout radius, against a 5% budget. Both topologies retained their communities through tick 100. After correcting the fractional mouse position, 39 of 999,999 live points in each fixture differed by more than one backing pixel on the first step. WebGPU build `c7c523be` and the frozen WebGL reference returned the correct targets for all 288 trusted clicks across both scheduling modes. The first WebGPU click produced visible feedback in 14–15 ms at a fixed tick. With the graphs moving it took 182 ms on dense communities and 282 ms on hubs. Peak tracked allocations in that block were 418.6 MiB for WebGL and 273.2 MiB for WebGPU. Both returned to zero after teardown.
[Prototype results](#/viewer-comparison?section=doc-migration-results) · [Packaged results](#/production-forces?section=doc-scale-timing)

## Current focus

```example
migrationFocus
```

**Qualify the replacement through the built packages.** The force replay checks one million points and 999,990 links. Its separate timing runs show which differences repeat across both engine orders. The Lines replay checks the painted stroke and the wider click target. [Lines](#/production-lines?section=try-straight) · [Forces](#/production-forces?section=try-gravity) · [Curve pilot](#/curved-links?section=doc-automated-cases)

```example
youtubeMotion
```

The Chrome 157 prototype comparison used 300,000 points, 300,000 links and
the same camera. It measured simulation ticks 13–72.
[Live demo](#/youtube-network?section=try-friendships-300k)

## Production Graph API

The first milestone is a developer opening the same story twice and getting the same result from the same gesture. The last milestone is an application importing the published `@cosmos.gl/graph` and running entirely on WebGPU. Use the following sequence to get from one to the other.

### How to port a module

Use the WebGL module as the starting point. Follow its folder, name, responsibility and coding style wherever they fit. For a stateful force, prefer the corresponding class and make it easy to find where it prepares data, applies one step and releases resources. Preserve when configuration changes take effect and which positions the next force reads.

All eight WebGPU force modules now have the same class and folder names as WebGL. The simulation supplies the current positions and compute pass, then integrates each correction. For springs this happens twice per tick because the second direction reads the positions produced by the first. [Spring updates](#/production-forces?section=doc-results-springs-repulsion-and-collision)

The simulation retains its compiled gravity and centering kernels across point-count changes. Cluster membership and attractor targets can change while the layout runs, so each replacement builds its buffers before releasing the previous instance. A centroid read that finishes after membership changes returns an empty array. The mouse force allocates its resources on the first pointer impulse.

When the implementations deliberately differ, record what WebGL does, what WebGPU does, why, and what an application can observe. Put the example and its check in the feature's Lab results and link it from the inventory. Changes that require application edits also belong in the public migration notes. [Collision grid sizing](#/production-force-collision?section=doc-results-collision-grid-sizing)

### Run the same story twice

Develop WebGPU in the private workspace package `experiments/graph-webgpu` on the same branch. Run the WebGL Storybook with `pnpm run storybook` on port 6006 and WebGPU with `pnpm run storybook:webgpu` on port 6007. Both read the same story files, assets and fixtures. The WebGPU preview resolves the public `@cosmos.gl/graph` import to the candidate entry. Each preview shows its engine and revision. The WebGPU Deck stories and the packed Deck consumer use Deck 10 alpha.1 with luma alpha.14. The WebGL preview uses its original Deck 9 and luma 9 dependencies.

Start with the same WebGL build in both previews. Use a paused fixture with overlapping points, identical typed arrays, a fixed camera, viewport and pixel ratio. Check that both previews paint the same scene and a click returns the same foreground point. Generate data once for stories that use randomness. This establishes a repeatable comparison before the first WebGPU draw.

`node scripts/check-storybook-pair.mjs` checks that Quick Start uses the expected engine and paints its points in both previews. Pass the WebGL preview URL twice to check the comparison setup itself. Run `node scripts/check-storybook-all.mjs` with both previews open to check their complete indexes, painted canvases, and all six sizes in the repulsion benchmark. Its `--webgl` and `--webgpu` options accept static preview URLs. For an offline replay, pass `--assets` a directory with the original `cities.csv`, `performances.json` and `ne_110m_admin_0_countries.geojson`. Use `--report FILE` to record their hashes and the result from every story. For the pinned point, endpoint picks and gravity step, use [Run the same Graph application](#/production-graph-api).

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

The packaged 8,192-slot graphs met the native M3 click margins. At one million points and 999,990 links, both dense and hub layouts passed their fixed-tick checks. WebGPU had fewer intersecting pairs at tick 100 in both three-force runs. The benchmark separately checks trusted clicks, point and topology edits, full replacement, resize and release of GPU allocations. WebGL control variation limits the verdicts about relative speed. [Layout and gates](#/production-forces?section=doc-scale-method) · [Paired timings](#/production-forces?section=doc-scale-timing)

The moving YouTube replay checks each lasso against that engine’s positions at release. On the signed WebGPU build, all eight long lassos returned exact ordered IDs and all 1,000 label coordinates. The unchanged WebGL package timed out at ticks 10 and 40 on the million-point graph. A fresh async run and a blocking control returned the expected IDs and label positions at all four ticks. [YouTube selection and labels](#/production-graph-api?section=doc-youtube-selection)

### Qualify and release the replacement

Exercise standalone Graph, headless simulation and the real `CosmosGraphLayer` on one supported luma family. Verify draw and pick in a host-owned pass, shared-device lifetime, initialization failure and recovery after device loss. Repeat the release scenarios on the supported browser and GPU range. Check the packaged builds, public types, Storybook and migration notes for async reads and custom host renderers.

At cutover, record the final WebGL revision and point historical comparisons to that build. Promote WebGPU to the main package and its normal distribution path. Publish Graph and the Deck integration in lockstep. The public Storybook then runs the WebGPU release, and the WebGL reference remains reproducible.

### Working candidate and remaining release checks

The same-branch candidate runs Quick Start in Storybook. Its browser tests cover resident simulation, input queued before initialization, pinned and absent slots, sparse edits, selection, label sampling, position and style transitions, and drawing and picking in a borrowed host pass. The paired gravity step runs in [Production Graph API](#/production-graph-api).

On the 65,536-point YouTube graph, both packages returned the expected rectangle IDs and all 1,000 label positions. In the final paired moving million-point rectangle run, WebGL hit its existing read timeout on all eight releases. The signed WebGPU bundle `6a6f1ceb` completed all eight, with medians of 251 ms for IDs plus labels and 541 ms from release to visible feedback. Profiling exposed an unhighlighted frame submitted between the selection IDs and the label positions arriving. Letting both finish before the next automatic draw, for at most one refresh, reduced median release-to-feedback from 647 to 551 ms across eight moving drags per build. At fixed ticks the old and new WebGPU builds agreed on every ID and all 1,000 positions. An exact tangent at the bottom edge differed from the ideal CPU projection. The point center projects to y = 488 with a radius of one pixel. Both real engines excluded it when the rectangle ended at y = 487 and included it when the edge moved to 487.00001. [Moving YouTube selection and labels](#/production-graph-api?section=doc-youtube-selection)

| Area | What the packaged runs establish |
| --- | --- |
| Force controls and layout quality | Above 4,096 points both engines now sample nearby points and group distant cells using the same quality settings. In the Lab's seeded replay of the 22,500-point lasso, initial expansion and late cluster motion closely matched on M3. A settled step and draw took 4.8 ms on WebGL and 1.9 ms on corrected WebGPU. The million-point dense and hub replays cover layout, cooling and overlap through tick 100 with the real packages. Repeat on another physical GPU. [Force comparisons](#/production-forces?section=doc-results) |
| Drawing and picking | On M3 at both pixel ratios, an opaque point covered a moving curve and owned the click. A 96 CSS px image showed the curve through transparent and translucent texels and kept the click 46 CSS px from center. At 1× up to ten curve-edge pixels per frame differed by one color level. The 2× frames matched exactly. Dashed gaps, overlapping translucent arrowheads and replacing only the links each preserved the expected drawing and click order. [Curve and image](#/production-graph-api?section=try-curved-link-image-crossing) · [Dashed crossing](#/production-graph-api?section=try-styled-link-crossing) · [Arrowheads](#/production-graph-api?section=try-translucent-arrow-crossing) · [Topology changes](#/production-graph-api?section=doc-method-replace-only-the-links) |
| Interaction at scale | On M3, editing point colors and sizes preserved the resident links. WebGPU clicks track the displayed size through an interruption. WebGL holds its last hit. At 1× and 2×, both packages returned identical rectangle and lasso IDs at all eight checkpoints. Both area tools use the target footprint by default and can switch to center selection. In the latest eight long lassos WebGPU returned every expected ID and all 1,000 label coordinates. The WebGL control timed out on two million-point releases in its first pass. Its blocking control and fresh async repeat returned the expected IDs and coordinates at all four ticks. [Point-only style updates](#/production-graph-api?section=try-point-style-updates) |
| Public API and packages | All 72 shared Graph story sources typecheck against both the WebGL distribution and the installed WebGPU tarball. Both static previews indexed the same 46 stories and four documentation pages. All 46 stories ran on both engines on M3. The visual stories painted a canvas and the repulsion benchmark completed all six graph sizes in each preview. The five Deck examples also run on the native WebGPU Deck host, including the map, offset mini graphs and the custom renderer. Quick Start, the selection gestures and the three moving readouts passed in both builds on M3. Area selection and moving position readouts use the fresh async queries on both packages. Two independent headless trackers kept their own indices and survived their peer’s destruction on M3. Graph now provides `flatten()`, `pair()` and `create()`. Both Graph and headless GraphSimulation expose cached cluster coordinates on WebGPU. The performance stories show FPS and CPU time. A custom renderer borrows the WebGPU position buffer for each draw. [Two headless trackers](#/production-graph-api?section=try-headless-trackers) |
| Deck and device recovery | The packed Graph and Deck Layers app restored 65,536 points and 32,768 links under both ownership modes. Chrome exercised GPU-process loss on Apple Metal and SwiftShader. Firefox 153, Safari 26.5.2 and WebKit 26.5 exercised explicit device destruction on the M3 host. All saved coordinates, camera, selection, first picks and first resumed cooling values matched. Qualification on another physical GPU remains open. [Checkpoint costs and browser results](#/integrated-webgpu?section=doc-host-ownership-checkpointing-65-536-points) |

The stock 200,000-point scatter now uses front-to-back rendering on the WebGPU canvas when opaque points overlap heavily. The signed build preserved every pixel with culling on and off, for opaque and mixed-alpha points. In two M3 runs the signed build completed an opaque draw in 6.60–9.65 ms and a mixed-alpha draw in 6.30–6.45 ms. The previous WebGPU package took 43–44 ms. [Point-only occlusion](#/production-points?section=doc-results-point-only-occlusion)

A callback or gravity change halfway through a style transition now preserves the 12-pixel point, 6-pixel link and label position. On M3 and SwiftShader the paired sparse replay agreed on 98 frames, 392 clicks and 980 area queries per adapter across the two pixel ratios. On both adapters a long point zoom now visits its midpoint, a later camera command takes over, and reads after destruction return empty geometry. [Style and sparse comparisons](#/production-graph-api?section=try-point-style-updates)

The M3 baseline before the selection scheduling change used WebGPU `c7c523be` and WebGL `74a216a7`. All 58 candidate tests, 218 default Lab checks and 285 default WebGL/Deck checks passed. The separate packaged hierarchy run and native host recovery test also passed. The other 22 opt-in Lab cases exercise earlier prototypes. The signed Storybook, suite logs and links to the full layout and selection captures are in `captures/signed-storybooks-12c2b599/qualification/`.

Source `951ec4d7` produced the signed WebGPU bundle `6a6f1ceb`. All 61 candidate tests, 218 default Lab checks and the separate packaged force check passed. The packed release rehearsal on Node 22 passed 63 Chromium software tests, including the two public Deck ownership cases. All 46 stories drew or completed their benchmark on each M3 preview. The previews each painted 51 GPU canvases. Two local CSS fetches failed in separate passes. Reopening those routes on both engines passed, as did the interactive story controls. The 18 million-point position files matched the previous signed WebGPU build. [Eight-force results](#/production-forces?section=doc-results) · [Packaged host results](#/integrated-webgpu?section=doc-host-ownership)

In a disposable checkout the ordinary public pack commands on Node 22 produced all nine signed Graph and Deck distribution files byte for byte. A clean app installed the tarballs with normal npm lifecycle scripts and strict peers. The default Pages build ran WebGPU Quick Start, the 48,000-point homepage and the real Deck layer. On SwiftShader the paused Deck story took 625–636 ms to report a hovered point. Moving to the background cleared it and returning to the same pixel reported the same ID. Both Lab panes independently stepped gravity and picked the moved point. The complete public rehearsal is in `captures/public-promotion-951ec4d7-20261126/`.

## What remains

1. **Put the public behavior checks in release CI.** The first disposable promotion still selected only the 15 WebGL test files. The rehearsed job exercises the WebGPU source and both Deck ownership modes, with a separate job for the historical WebGL suite. A raw canvas clear and readback identified the compositor settings needed on Linux. Requesting a SwiftShader adapter had already succeeded with the first-draw failure still present. Bring the packaged two-layer timeline check into the default job. Then port viewport dragging, stale bounds after data replacement, setters queued before initialization, extreme coordinates and polygon boundaries. A clean app should compile and pick correctly from the release tarballs.
2. **Qualify a second physical GPU.** The complete local package check used an Apple M3. Chrome, Firefox and Safari exercised that machine, and SwiftShader added software coverage. On another physical GPU family run the same sealed Graph and Deck packages, both ownership modes, drawing and picking, moving YouTube selection, and both composed million-point layouts. Record the actual vendor and measure fresh WebGL controls there. Access to that hardware is still open. [Replay the sealed archives](#/integrated-webgpu?section=doc-host-ownership-replay-the-same-archives-on-a-second-physical-gpu) · [Force procedure](#/production-forces?section=doc-scale-method)
3. **Settle the remaining interaction timing and showcase decisions.** Both engine orders met the first-click allowance on the fixed-tick hub. On dense communities WebGPU took 14.2 and 14.4 ms, while WebGL took 8.2 and 15.5 ms. With normal loops running WebGPU averaged 182 ms for the first visible dense click and 282 ms on hubs. WebGL measured 995 and 1,108 ms. The WebGL controls varied beyond the declared limits, so the relative result remains unassessed. The full Roads and ten-million-point showcases also exceed the current resource limits described below. [Original timing runs and pointer profile](#/production-forces?section=doc-scale-timing)
4. **Promote Graph and Deck together after acceptance.** The public builds still produce WebGL. Rehearse with the chosen dependency versions, use the normal lockstep package and Pages builds, and verify the Lab loads the frozen WebGL reference alongside the promoted Graph. The local rehearsal passed the packaging and default Storybook switch. The consumer compiles with strict app checking and `skipLibCheck: true`. With dependency declarations checked too, Graph passes on TypeScript 6.0.3 but math.gl fails on 5.9.3. The full Deck app hits a luma declaration error on 6.0.3. Qualify the supported compiler and dependency versions before publication. [Package and ownership checks](#/integrated-webgpu?section=doc-host-ownership)

Both installed packages drew one million points in one call and rendered all five stock website scenes on M3. WebGL also completed the ten-million-point draw. Ten million WebGPU positions need 160 MB. The device grants 128 MiB per storage binding, although the underlying adapter advertises a larger limit. The current simulation also dispatches one workgroup per 64 points along a single dimension. At ten million points that requires 156,250 groups against a limit of 65,535. The full California–Nevada road graph has 1,890,815 points and needs 181.5 MB for point styles alone. Decide how those two existing showcases will run before switching the public website.

## Feature coverage

[Browse benchmarks and migration studies](#/?section=migration-studies)

```example
featureCoverage
```

## Parked investigations

These are earlier prototype findings. Use the packaged comparisons above for current release decisions. Reopen an isolated case when the same difference affects the application.

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
