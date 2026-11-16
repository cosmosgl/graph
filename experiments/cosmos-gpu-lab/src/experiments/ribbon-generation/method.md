# Compute ribbon generation

Investigation stopped. This article documents the tested approach and research context; it is not an active work plan.

Does sharing curve samples cost less than reconstructing every ribbon vertex? This is a separate WebGPU cost experiment, not a replacement for the [curved-link compatibility study](#/curved-links).

## Start simple

The WebGPU migration should exploit GPU-resident storage and compute where they reduce total cost. Keeping an old algorithm solely for API similarity is not the goal; neither is replacing inexpensive vertex work with an expensive compute pipeline.

The first candidate stores a world-space center and normal per curve sample. Each 64-thread workgroup processes consecutive samples; each invocation computes one center/normal independently. The two ribbon sides and both drawing passes reuse it. Vertex extrusion still handles width, zoom, DPR and the coverage carrier. Both methods use the original curved experiment's WGSL, production power-spaced sample attributes, finite-difference normals, fragment coverage and color-face ID policy.

```flow
Resident endpoints and links
Vertex baseline · three conic evaluations per ribbon vertex
Compute candidate · three conic evaluations per sample → storage cache
Vertex extrusion · same width, camera and side rules
Hardware rasterizer · same color / optional ID passes
Untimed color and ID readback · compare every pixel
```

The three methods are:

| Method | Geometry work charged per frame | Additional sample cache |
| --- | --- | --- |
| Vertex baseline | Repeated for each side and draw | None required |
| Compute rebuild | One compute pass, then cache reads in each draw | 16 bytes × links × (segments + 1) |
| Compute reuse | Cache reads only; initial build excluded | Same cache |

A duplicate vertex baseline is interleaved as a noise control. At 19 segments there are 20 samples and 40 ribbon vertices: 120 conic evaluations per link per color draw in source, versus 60 in compute. With IDs the baseline repeats that work; compute shares it. These counts are not speed predictions. Storage traffic, dispatch overhead, vertex scheduling and fragment fill determine actual cost.

At 100,000 links and 19 segments the sample cache alone is **30.52 MiB**. The original benchmark reported incremental cache bytes, not total VRAM. Both renderers coexist during comparison; pipeline, target and common input memory are excluded from this incremental figure. Resource and binding-size limits are checked before buffer allocation.

## What is measured

The original controls covered 1,000–100,000 links, short and overlapping curves, color with or without IDs, and 1/3/19/32 segments. The recorded screen lists the subset actually measured. One segment is a chord control using the general curve shader, not an optimized straight-line baseline.

Endpoints are frozen and already resident. **Rebuild** deliberately regenerates every frame, charging the generation cost needed when positions change; it does not simulate motion. **Reuse** is the settled-layout steady state, with its initial generation outside timing. Camera/style changes could reuse centers/normals, but production invalidation is not implemented here. Endpoints, topology, curve weight, control distance or segment count must invalidate this cache in a future integration.

Resources and pipelines are created once per run. Three lanes warm up for four frames each. Eight rounds rotate all four trial labels; each trial measures eight compute/render frames in one submission. Each timestamp pair encloses one pass; only durations inside a pass are subtracted, then summed. The instrumented GPU sum includes compute and render pass durations, not gaps between passes. Instrumentation can change scheduling; do not substitute this sum for normal frame latency. A second, uninstrumented eight-frame batch measures submission-to-completion wall time, including CPU encoding, submit and completion wait, but excluding setup and readback. It is a throughput estimate, not interactive frame latency or FPS. GPU timings alone cannot establish end-to-end improvement.

All raw samples, timer availability, workload, device, browser and dates are exported. Missing/invalid timers stay unavailable. Cancellation discards the incomplete comparison; navigation releases resources after pending work finishes. Display and validation image readbacks are outside measured batches. Separate color and ID targets avoid pass feedback; each frame clears its attachments.

## Checks and screening decision

Every selected workload compares full RGBA8 color and ID images exactly, even when timing color alone. Static reuse is also compared with rebuilding. The baseline must render nonempty color. These checks establish bounded preservation against the existing WebGPU path, not mathematical accuracy or WebGL compatibility. The existing 36 rejected curved-link configurations remain rejected under their original contracts; moving construction into compute does not resolve raster interpolation differences.

The initial decision is deliberately a screening heuristic: reject rendering changes; withhold a speed conclusion without usable timestamps; repeat when the duplicate baseline differs by more than 10%. A candidate is promising only when median GPU saving exceeds both 10% and twice the duplicate-baseline discrepancy, with no more than 10% regression in uninstrumented completion time. This is not a statistical confidence interval or a production acceptance threshold. Review raw samples and repeat before advancing. Static reuse success alone does not support adoption for moving layouts.

## Research context

Sources reviewed 16 November 2026:

- [WebGPU buffer usages and execution model](https://www.w3.org/TR/webgpu/#buffer-usage): compute can write storage consumed by later rendering, without CPU readback. This is the mechanism exercised here.
- [WebGPU Compute Boids sample](https://webgpu.github.io/webgpu-samples/?sample=computeBoids): a worked compute-to-render resident-data pattern. It demonstrates API feasibility, not ribbon performance.
- [WebGPU timing guidance](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html): timestamp-query is optional; GPU, JavaScript and overall performance measurements answer different questions. This motivates both pass timing and uninstrumented completion measurement.
- [GPUWeb indirect drawing specification](https://gpuweb.github.io/gpuweb/#dom-gpurendercommandsmixin-drawindirect): GPU-written draw arguments enable a later visibility/compaction experiment. Preserve source IDs and stable transparent draw order; unordered atomic append is not automatically equivalent.
- [Vello renderer overview](https://github.com/linebender/vello/blob/main/README.md): current work explores CPU, hybrid GPU and compute-centric vector rendering. The compute renderer is experimental; the GPU renderer preprocesses paths on the CPU. This supports comparing complete architectures rather than assuming compute everywhere wins. Its results are not evidence for cosmos ribbons, whose endpoints already live on the GPU.

Adaptive tessellation, visibility compaction and compute rasterization were possible alternatives identified during research. None was tested here, and no follow-up is planned.

## Reproduce

The page now retains documentation and recorded findings without starting a GPU session. The original benchmark harness is retained for explicit command-line reproduction; see Recorded findings for the opt-in command and environment.

Focused checks: `pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/ribbon-generation`. Software-adapter checks verify execution and preservation only. Native measurements require a verified native device.
