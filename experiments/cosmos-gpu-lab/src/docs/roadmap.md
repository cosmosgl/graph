**Migration requires comparable behavior and no meaningful slowdown against production WebGL.** The million-point WebGL baseline is pending.
[Pilot assessment](#/pilot-viewer?section=doc-findings) · [Performance rule](#/validation-workflow?section=performance-against-production-webgl)

## Current focus

```example
migrationFocus
```

## What remains

- **Scope** Start with native Chrome on M3 and three million-point graphs. Use the same workloads and compare startup, updates, memory and layout quality on both backends. [Acceptance scope](#/million-graph?section=doc-production-envelope)
- **Moving performance** The million-point three-force WebGPU runs reach about 50 ms p95. YouTube with 2.85 million links reached 51.9 ms p95. Measure the equivalent production WebGL workloads and compare steady frames, interaction and updates. Keep the earlier 68.2 and 100.4 ms stalls in the pick assessment. [Timing evidence](#/million-graph?section=doc-interactive-study)
- **Full simulation** All eight forces match recorded CPU checkpoints through 32,768 points. The resident approximation runs all eight through one million with exact link indices, pins and absence. Both million-point WebGPU layouts take about 267 ms p95. Compare the same force set with production WebGL. Profile collision where it causes a slowdown. Retest dense overlap, multiple hubs, adaptive sampling, cell crossings and long cooling at scale. [Full-force evidence](#/integrated-webgpu?section=doc-composed-interaction)
- **Appearance and picking** Moving circles and solid straight links match the checked interiors. Isolated shapes, images, rings, widths, gradients and patterned link studies still show some mask and color differences. Resolve visible ownership at edges and overlaps, then check arrows, hover, focus and depth-based occlusion in the same moving renderer. [Moving styles](#/viewer-comparison?section=doc-findings) · [Feature coverage](#feature-coverage)
- **Graph workflows** Exercise actual WebGPU setters, topology replacement, resize, transitions, callbacks, dragging and Fit. Async selection and tracked coordinates already run through the production WebGL Graph. Compare area selection and label latency on the same moving graphs, and resolve the two observed polygon edge discrepancies. [Readback evidence](#/integrated-webgpu?section=doc-readback)
- **Deck, recovery and release** Use one supported luma version for the production Graph and Deck WebGPU paths. Verify same-device draw, pick and teardown, then recover a full session from unexpected loss and check WebGL availability when WebGPU cannot start. The M3 controls cover current production WebGL and a Lab WebGPU restart. Extend the browser and GPU scope before public release. [Host evidence](#/integrated-webgpu?section=doc-host-ownership)

## Feature coverage

```example
featureCoverage
```

## Parked investigations

Revisit these studies when the pilot exposes the issue or the feature enters scope. Review the retained failures before approving full migration.

- [Ordered prefetch for hubs](#/integrated-webgpu?section=doc-findings-star-bottleneck-and-one-bounded-candidate). The 8,192-point star misses timing. The newer three-hub runs quantify the spring cost at 16,384 and 32,768 points.
- [Straight-link caps and edges](#/straight-links?section=doc-method). Boundary failures remain in the frozen checks. Resume if thin links disappear, picking disagrees with visibility or the pilot exceeds the edge tolerance.
- [Curved links and dash/dot boundaries](#/curved-links?section=doc-method). Pattern mask failures remain. Resume when curves or patterns enter scope and check motion, color and source visibility.
- [Fractional and polygon point edges](#/point-styling?section=doc-method). Some masks and color-preserving alternatives fail. Resume if the circle pilot shows a defect or more shapes enter scope.
- [Faint-alpha picking](#/point-styling?section=doc-method-stored-alpha-picking-prototype-16-november-2026). The candidate fixes selected visibility cases at a cost under dense overlap. Resume if picking is wrong or slow, or images or translucent overlap enter scope.
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
