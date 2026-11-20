**Prototype demonstrated on Apple M3.** Cosmos ships with WebGL while production validation continues.
[Pilot assessment](#/pilot-viewer?section=doc-findings) · [Acceptance rules](#/validation-workflow?section=first-migration-rules)

## Current focus

```example
migrationFocus
```

## What remains

- **Performance** Bring 95% of steady frames within 33 ms on dense, hub and real graphs. [Earlier callbacks and depth-tested links](#/million-graph?section=doc-interactive-study) still miss the target.
- **Simulation and rendering** Validate the remaining [features](#feature-coverage) and check layout quality across longer runs and more graph shapes.
- **Graph and host integration** Finish Graph setters, async readback and device recovery. Verify [Deck hosting](#/integrated-webgpu?section=doc-host-ownership) on a supported luma version.
- **Production acceptance** Apply the [M3 scope and working budgets](#/million-graph?section=doc-production-envelope) to the dense, hub and YouTube workloads. Verify the target GPUs and browsers.

## Feature coverage

```example
featureCoverage
```

## Parked investigations

Revisit these studies when the pilot exposes the issue or the feature enters scope. Review the retained failures before approving full migration.

- [Large hubs in the 8,192-point star](#/integrated-webgpu?section=doc-findings-star-bottleneck-and-one-bounded-candidate). Timing still fails with ordered prefetch. Resume when the supported workload includes large hubs.
- [Straight-link caps and edges](#/straight-links?section=doc-method). Boundary failures remain in the frozen checks. Resume if thin links disappear, picking disagrees with visibility or the pilot exceeds the edge tolerance.
- [Curved links and dash/dot boundaries](#/curved-links?section=doc-method). Pattern mask failures remain. Resume when curves or patterns enter scope and check motion, color and source visibility.
- [Fractional and polygon point edges](#/point-styling?section=doc-method). Some masks and color-preserving alternatives fail. Resume if the circle pilot shows a defect or more shapes enter scope.
- [Faint-alpha picking](#/point-styling?section=doc-method-stored-alpha-picking-prototype-16-november-2026). The candidate fixes selected visibility cases at a cost under dense overlap. Resume if picking is wrong or slow, or images or translucent overlap enter scope.
- [Compute-generated ribbons](#/ribbon-generation?section=doc-findings). Keep the vertex path after the cost and color checks. Revisit if profiling shows curve generation is a substantial bottleneck.
- [Direct WebGL reset at 100,000 points](#/weighted-links?section=doc-context-loss). Bounded ordered passes now complete on M3. Revisit if the direct baseline is needed or the bounded path resets.
- [Collision at larger scale](#/collision?section=doc-hashed-findings). Bounded WebGL comparison and 8,192-point timing are recorded on M3. Revisit for larger dense graphs with the production seed stream.

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
