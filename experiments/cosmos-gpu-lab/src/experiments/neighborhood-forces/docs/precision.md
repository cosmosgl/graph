# Fixing dense-case precision

Follow-up: [reducing the cost of this fix](#/neighborhood-forces/docs/precision-cost) compares
the preserved fixed baseline with a chunked traversal optimization.

**The five historical failures came from long float32 force sums.** A deeper check also found a
one-ULP cutoff classification difference. The current kernel fixes both without changing the force
formula, radius, CPU reference arithmetic or any acceptance threshold.

On the native Apple / Metal 3 adapter, the final fixed kernel passed **12/12 dense initial-state runs**
and **3/3 evolved-state checks**. Each check covered **1,148 points**: the union of the original 128
sample points and 1,024 evenly spaced points, with every output checked for finite values.
This is stronger sampled evidence, not an exhaustive proof for all 65,536 points or every device.

Measurements vary by GPU, browser and system load. The findings are recorded here; use the
reproduction steps to collect your own results with the lab’s JSON export. Raw captures are not stored in Git.

## Reproduce it

Start the lab with `pnpm --filter @cosmos.gl/gpu-lab dev` from the repository root.
On [Neighborhood forces → Demo](#/neighborhood-forces), choose **Check dense precision**. It runs a fixed matrix independent of the visible
preset: 65,536 deterministic uniform points, density 16×, radius 0.16, grids 16 / 32 / 64, four
repetitions per grid and shader. Shader order reverses on alternating repetitions. Export JSON when
it finishes. The preserved serial shader is a diagnostic control; normal simulation uses the fix.

The first two repetitions also time the force stage, one operation per sample, two warm-ups and eight
measured samples. The first fixed-kernel repetition on each grid advances three simulation steps and
validates again. Expect about a minute on the measured device; slower devices may take longer.

## Isolate individual forces from their sum

For the checked point with the highest error/tolerance ratio, a diagnostic GPU dispatch writes every
individual pair contribution to a temporary buffer. It uses the same contribution function as the
force kernel and retains the grid/scatter order. A visited-cell flag lets the CPU replay precisely the
candidate sequence, including rejected candidates whose contribution is zero.

We then sum those captured values three ways on the CPU: serial float32, double precision, and the
blocked float32 algorithm. The diagnostic readbacks are outside all performance measurements.

For point **11,082** in the final study's first serial run:

| Quantity | Value |
| --- | ---: |
| Actual neighbors | 21,198 |
| Unchanged force tolerance | 0.0002610 |
| GPU serial error | 0.0005026 — fails |
| CPU serial float32 replay error | 0.0005322 |
| CPU double sum of the same GPU contributions | 0.000000445 |
| CPU blocked replay error | 0.00001554 |

Across the final captures, double re-sums stayed within **0.000000646** of the independent reference.
Serial replay closely reproduced the GPU's much larger error; differences up to 0.0000475 remained,
consistent with permitted compiler arithmetic transformations. This isolates accumulation as the
main force-error source, rather than missing neighbors or inaccurate pair forces.

Many contributions point in opposing directions. Large intermediate sums lose low bits; cancellation
later exposes that lost information in a much smaller final force. Unspecified scatter ordering changes
where rounding occurs, explaining why the original 128-point check sometimes passed and sometimes failed.

## Fix 1: bound the accumulation chains

The grid kernel now sums **64 candidate contributions per block**, then **16 blocks per group**, then
adds group totals. At the experiment's 65,536-point maximum, each serial chain is at most 64 additions
apart from tail handling. The all-pairs path sums its 128-point tiles in two blocks of 64; its 4,096-point
limit similarly bounds the total number of block sums.

```flow
Pair contributions
Blocks of 64
Groups of 16 blocks
Sum group totals
Apply strength once
```

This changes the grouping of additions, not which neighbors contribute. Neighbor and candidate counts
remain exact integer-valued float32 quantities within the supported point limit. No extra simulation
buffers or GPU dispatches are needed for the fix.

The first one-level block attempt already removed sampled force failures, but its expanded check used
up to 73% of the allowed error. The second level gives more margin. In the final, broader check, the
worst error/tolerance ratio was **0.298**.

Blocking reduces rounding error; it does not make arbitrary float32 sums exact or order-independent.
The regression suite includes an adversarial cancellation sequence to preserve that distinction.

Why not simply Kahan? [WGSL permits reassociation and fusion](https://www.w3.org/TR/WGSL/#floating-point-evaluation),
so an optimizer can invalidate algorithms that rely on particular rounding steps. The
[luma.gl precision guide](https://luma.gl/docs/api-guide/shaders/gpu-floating-point-precision) discusses
this limitation. We tested the block method on the native Apple adapter and Chromium's software adapter;
other devices still need validation.

## Fix 2: preserve the cutoff's rounding contract

The expanded sample found point **53,619** missing neighbor **593**. The pair was almost exactly on
the radius boundary. The CPU reference rounds each squared component before adding. A permitted fused
GPU evaluation rounded the final result differently:

| Float32 calculation | Squared distance |
| --- | ---: |
| Separately rounded products, then rounded addition | 0.025599997490644455 |
| Fused evaluation, rounding one product with the addition | 0.025599999353289604 |
| Squared radius | 0.025599999353289604 |

The first result is inside the radius; the fused result equals the cutoff and is excluded. Its force
contribution is tiny, but the neighbor-count contract is exact, so ignoring the difference is not acceptable.

The fixed shader keeps the fast dot product away from the boundary. Near the cutoff, it materializes
the product bits and uses integer mantissa/exponent alignment with guard, round and sticky bits to
perform a round-to-nearest, ties-to-even addition. Integer operations prevent the products from being
fused into that addition. The final comparison remains **squared distance < squared radius**.

The small window only selects the recomputation path; it does **not** enlarge the radius or accept
ambiguous counts. The CPU reference predicate and exact count assertion are unchanged. This narrow
helper handles the bounded nonnegative squared-distance products used here, not general-purpose fp64.

## Final validation and cost

Four repetitions per shader/grid, 1,148 checked points per run, same input snapshot:

| Grid | Serial force failures per run | Fixed force failures | Largest serial force error | Largest fixed force error |
| --- | --- | --- | ---: | ---: |
| 16×16 | 5–9 | 0 in every run | 0.001451 | 0.000115 |
| 32×32 | 7–8 | 0 in every run | 0.002115 | 0.0000894 |
| 64×64 | 6–9 | 0 in every run | 0.001687 | 0.0000789 |

Serial also missed the same cutoff neighbor in every expanded check. Fixed counts matched exactly;
all fixed integrated positions and velocities passed, including the three evolved-state checks.
The force threshold is still **0.0002 + 0.0002 × CPU force magnitude**. Position and velocity limits
remain **0.00005**. There were no non-finite outputs.

Force-only GPU time, median of two row-level p50 measurements per shader/grid, on the native Apple adapter:

| Grid | Serial control | Fixed kernel | Additional time |
| --- | ---: | ---: | ---: |
| 16×16 | 216.66 ms | 317.49 ms | 47% |
| 32×32 | 141.39 ms | 177.05 ms | 25% |
| 64×64 | 172.65 ms | 187.86 ms | 9% |

The serial timings are diagnostic costs of an **incorrect baseline**, not eligible winning benchmark
rows. Normal Benchmark and Sweep still refuse to time invalid results. These dense force passes are
already long enough to measure individually; they are not rendering or full-tick timings. Two timed
repetitions on one device do not establish hardware-independent overhead.

The fix trades additional arithmetic/control work for accuracy. The earlier
[batched findings](#/neighborhood-forces/docs/batched-results) measured the serial kernel and are
preserved as historical evidence; their timings are not measurements of the fixed kernel.

## Regression coverage

`pnpm --filter @cosmos.gl/gpu-lab test:gpu` passes **20 tests**, including:

- The exact captured cutoff pair through both production force methods.
- 1,007 positive-addition cases covering ties, mantissa carry and large exponent differences.
- Nine cancellation/cutoff targets against all 65,536 dense input points, across all three grids,
  using the production grid body with only the invocation-to-target mapping changed for test speed.
- Existing boundary, coincidence, partial-workgroup, evolved-state, timing and sweep contracts.

The native study above is separate from software-adapter test performance. Future optimization should
retain these accuracy checks while reducing branch/counter overhead or improving summation structure.
