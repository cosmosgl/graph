# Correctness

## Reference calculation

The CPU iterates over the same `Float32Array` used for GPU upload, but JavaScript arithmetic accumulates the values as
double-precision numbers. This is a useful reference, not a claim that the GPU should match every bit.

## Why the answers differ

Floating-point addition is not associative:

```text
(a + b) + c ≠ a + (b + c)
```

The implementations add values in different orders:

- CPU: linear input order using JavaScript numbers.
- WebGL: implementation-dependent fragment and blend order using `f32` storage.
- WebGPU: a defined tree shape inside each workgroup, followed by a second tree over partials.

Consequently, exact equality is the wrong invariant. The useful measurements are absolute center error and the delta
between backends.

## Current smoke result

For the deterministic initial state used by the demo, the local validation run observed errors around `10⁻⁹`. See the
Results page for the recorded values and environment limitations.

## Tests to add before migration decisions

1. Empty and single-point inputs.
2. Point counts around workgroup boundaries: 255, 256 and 257.
3. Non-power-of-two partial counts.
4. Large positive and negative values with cancellation.
5. Highly clustered and highly asymmetric distributions.
6. NaN and infinity policy.
7. Repeated simulation ticks to measure divergence, not only one reduction.
8. Multiple GPU vendors and browser implementations.

The simulation-level test matters most: a tiny center difference can be harmless for one tick yet accumulate through a
chaotic force system.
