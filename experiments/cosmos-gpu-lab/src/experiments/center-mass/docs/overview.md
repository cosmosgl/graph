# Global center of mass

This experiment isolates one operation used by a force simulation: reduce every point position into one global center.
It compares the current Cosmos-style WebGL technique with a WebGPU compute implementation while keeping the input,
tick order and CPU reference identical.

![WebGL and WebGPU reduction pipelines](reductionPipeline)

## Question

Can a portable WebGPU compute reduction replace the additive floating-point blend used by the WebGL engine without
changing the result enough to affect simulation behavior?

## What the demo does

- Generates 8,192 deterministic `float32x2` points.
- Advances the same point array once per tick.
- Computes an `f64` CPU reference.
- Uploads the snapshot independently to WebGL and WebGPU.
- Reads both GPU results back and reports their distance from the CPU value.
- Draws the same points as one-pixel primitives and marks the computed center in red.

The visualization is deliberately minimal. It exists to expose the compute path, not to reproduce the complete Cosmos
renderer.

## Result shape

Both paths accumulate the same four values:

```text
(sumX, sumY, count, unused)
```

The reported center is:

```text
centerX = sumX / count
centerY = sumY / count
```

Small differences are expected because floating-point addition is not associative and the two GPU paths reduce values
in different orders.
