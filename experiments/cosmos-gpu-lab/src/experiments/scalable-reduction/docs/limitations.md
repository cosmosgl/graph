# Limitations and next steps

- The first dispatch is one-dimensional. Counts beyond the device workgroup-dispatch limit need grid-stride loading or
  a two-dimensional dispatch. Counts above 16,777,216 would also need a different count representation to keep every integer exact.
- Workgroup size is fixed at 256 instead of being selected from device limits and measured performance.
- The benchmark uses queue completion rather than GPU timestamp queries.
- The interactive CPU reference stops at one million points. The automated check also compares the ten-million-point center.
- The analytical CPU reference does not reproduce every per-point `f32` rounding step after many rotations.
- Device-loss recovery is not implemented.
- Sampled rendering shows at most 500,000 points and is not a density-preserving level-of-detail system.
- The reduction is unweighted; every point contributes a mass of one.

Natural extensions are timestamp-query measurement, recursive command graphs, weighted centers, bounds reduction,
compensated summation and reuse of the partial buffers by scan/grid construction.
