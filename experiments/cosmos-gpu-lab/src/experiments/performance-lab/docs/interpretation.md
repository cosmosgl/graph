# Interpreting results

## Compare within one run

The relative multiplier in the table is the useful first signal: `1.00×` is the fastest completion
median in that run. Compare reports only when browser, device, power state, canvas, count, point
diameter and sampling preset match.

## Rendering expectations

WebGL begins with a geometry advantage for circles: one submitted point versus six WebGPU quad
vertices. That does not guarantee a WebGL win. At larger diameters, fragment coverage and blending
can dominate vertex cost; at large counts, storage-buffer access, pipeline overhead and driver
behavior also matter.

Test all three diameter presets. A two-pixel sparse point workload and a twenty-four-pixel dense,
transparent workload exercise very different bottlenecks.

## Simulation expectations

The algorithms are intentionally different because this is the real migration choice:

```text
WebGL:  N fragments → one additive float attachment
WebGPU: N inputs → workgroup partials → recursive compute passes → one result
```

WebGL's single draw is compact but depends on float render-target blending. WebGPU performs more
explicit passes, but has workgroup memory, storage buffers and a path to keep the result resident for
later simulation and rendering.

The current benchmark measures center-mass reduction only. It does not yet establish performance
for integration, link forces, grid construction, many-body forces, picking or the complete frame.

## Warning signs

- Large `p95 − p50`: background work, thermal changes, compilation, or an unstable workload.
- Very high setup with low steady-state time: pipeline compilation or allocation dominates short sessions.
- Low submit time but high completion time: the workload is GPU/queue bound rather than JavaScript bound.
- WebGL unavailable: required float blending is missing; this is a compatibility result, not a zero score.
- Correctness error growing with count: numerical order or accumulator precision needs investigation.

## Next measurement refinement

Add optional `timestamp-query` and `EXT_disjoint_timer_query_webgl2` paths. They should appear as a
third, explicitly named “GPU timestamp” column while retaining synchronized completion as the
portable baseline. Never substitute CPU submission duration when timestamps are unavailable.
