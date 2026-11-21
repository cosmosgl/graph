# Implementation

## Buffers

The experiment allocates:

- One `float32x2` storage buffer for all positions.
- Two equally sized `vec4f` partial buffers for ping-pong reduction.
- One 16-byte readback buffer.
- Small uniform buffers containing the input count for each level.

For ten million points, positions consume approximately 76.3 MB and both partial buffers together consume about
1.2 MB.

## Resident initialization and movement

An integer hash generates deterministic positions directly in storage memory. A second compute shader applies a small
rotation to every position on each tick. There is no CPU point array and no per-frame position upload.

Because the movement is a uniform rotation, the CPU reference center can be advanced analytically for presets through
one million points. The ten-million preset skips the CPU reference to keep configuration responsive.

## Rendering

Rendering reads positions as a storage buffer from the vertex shader. At most 500,000 evenly spaced records are drawn,
which keeps the visualization useful without making display cost scale all the way to ten million points.

The center marker vertex shader reads the final reduction buffer directly:

```wgsl
let center = result[0].xy / result[0].z;
```

It remains visible even when CPU readback is disabled.

## Device limits

Before allocating, the experiment checks:

- `maxStorageBufferBindingSize`
- `maxBufferSize`
- `maxComputeWorkgroupsPerDimension`

Unsupported presets fail locally with the relevant limit rather than relying on browser or operating-system detection.
