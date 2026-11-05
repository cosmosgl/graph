# Limitations and next steps

- The first dispatch is one-dimensional. Counts beyond the device workgroup-dispatch limit need grid-stride loading or
  a two-dimensional dispatch.
- Workgroup size is fixed at 256 instead of being selected from device limits and measured performance.
- The benchmark uses queue completion rather than GPU timestamp queries.
- CPU correctness is skipped above one million points.
- The analytical CPU reference does not reproduce every per-point `f32` rounding step after many rotations.
- Device-loss recovery is not implemented.
- Sampled rendering shows at most 500,000 points and is not a density-preserving level-of-detail system.
- The reduction is unweighted; every point contributes a mass of one.

Natural extensions are timestamp-query measurement, recursive command graphs, weighted centers, bounds reduction,
compensated summation and reuse of the partial buffers by scan/grid construction.
