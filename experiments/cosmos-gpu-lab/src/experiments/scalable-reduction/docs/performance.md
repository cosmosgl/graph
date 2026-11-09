# Performance modes

## Interactive tick

With readback enabled, the displayed time includes command encoding, compute, rendering, queue completion and mapping a
16-byte result buffer. This is useful for interactive latency and correctness checks.

With readback disabled, JavaScript returns immediately after submission. That number measures CPU encoding and submit
latency; it does **not** measure completed GPU execution.

## Bounded benchmark

The Benchmark button records several reduction hierarchies into one command buffer, submits once, and waits for
a luma fence:

- 100 iterations below one million points
- 20 iterations at one million points
- 5 iterations at ten million points

The result excludes position generation, movement, rendering and readback. It is still a CPU wall-clock measurement,
not a timestamp-query measurement, and should be treated as exploratory.

## Production goal

The valuable architecture is the absence of transfers between simulation stages:

```text
resident positions → reduction → forces → integration → rendering
```

A production command graph can encode those dependencies once and reuse intermediate storage across center, bounds,
grid, scan and scatter operations.
