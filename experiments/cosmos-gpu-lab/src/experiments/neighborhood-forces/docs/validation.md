# Correctness before speed

**Validate next step** reads the current state, computes forces and a trial integrated state on
the GPU, and compares against an independent JavaScript all-pairs reference. It leaves the active
buffer index and displayed tick unchanged. The next real step recomputes its force.

For up to 1,024 points every point is checked. Larger datasets check 128 evenly spaced deterministic
point indices against all other points. This is a sampled result, not an exhaustive proof.
All returned positions, velocities and force/count records are additionally checked for finite values.

| Quantity | Acceptance rule |
| --- | --- |
| Neighbor count | Exact agreement for every checked point |
| Force vector | Euclidean error ≤ 0.0002 + 0.0002 × CPU force magnitude |
| Integrated position | Maximum checked Euclidean error < 0.00005 |
| Integrated velocity | Maximum checked Euclidean error < 0.00005 |
| Non-finite outputs | None anywhere in the readback |

The CPU reference uses float32-rounded coordinate differences and squared distances for the cutoff,
then higher precision accumulation. GPU arithmetic can fuse operations and accumulation order differs,
so tolerances apply to vectors. A distance extremely close to the cutoff can expose floating-point
classification differences; an exact neighbor mismatch is reported, not silently accepted.

Scatter order within a cell is unspecified. That changes the order of floating-point additions.
Small trajectory differences over many ticks are expected, even if individual steps pass. Each
method is validated against its own current input snapshot; visual similarity is not the correctness
test, and long-term trajectories are not required to be bitwise identical.

## Regression cases

The browser test file alongside the implementation exercises CPU pair symmetry, isolated points,
exact cutoffs, coincident points, reflecting walls, partial workgroups, boundary positions, clustered
and diagonal distributions, radii spanning multiple cells, repeated ticks and borrowed grid resources.
GPU tests require an available WebGPU adapter; they explicitly skip when one is unavailable.
Test execution results should state whether those GPU cases actually ran. To require a WebGPU adapter
and enable Chromium's software backend for local regression checks, run from the repository root:

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu
```

This dedicated command fails rather than skips if an adapter cannot be created. Software-adapter
test durations must not be used as hardware performance evidence.

Measurement tests additionally check 64-bit timestamp conversion, optional-feature fallback, stage
query boundaries across repeated operations, bounded calibration, per-operation normalization, deterministic sweep coverage/order, density scaling, partial cancellation and
explicit all-pairs skips. The timestamp-enabled case skips on adapters without that optional feature;
the no-timestamp fallback is tested independently.

Benchmarking resets both paths and requires validation to pass before recording samples. Exported
JSON includes the checked population, errors and raw measurements. A sampled pass at 65,536 points
does not establish correctness for every point or every future state.

The [batched study](#/neighborhood-forces/docs/batched-results) records dense-case force-tolerance
failures from the native Apple GPU separately from the passing automated regression suite.

## Dense precision investigation

**Check dense precision** compares the preserved serial shader and current fixed kernel at 65,536
points, density 16×, radius 0.16. Each run checks the union of the baseline 128 sample points and an
additional 1,024-point grid (1,148 distinct points). The export includes the worst force error relative
to its existing tolerance, exact count mismatch details and CPU re-sums of captured GPU contributions.
The [precision findings](#/neighborhood-forces/docs/precision) document the fix and its cost.
