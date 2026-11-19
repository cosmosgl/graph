# Sharing distant repulsion

Can points in one cell share the push from distant clusters and still move
like the current WebGPU graph? The control is the existing per-point WebGPU
solver with native arithmetic, eight near samples and GPU-built hierarchy.
The alternatives sample each occupied cell's distant sources at its geometric
center, or at its four corners with bilinear interpolation. All four corners
use the owning cell's source list. Neighboring cells can have different lists,
so the two sides of a shared edge can still receive different pushes.

## M3 result

**Four corners is the better candidate.** Including the cost of building the
field and drawing the graph, it saved about 9 ms per tick on both inputs. At
tick 200, 95% of 4,096 tracked points were within 0.78 pixels of the current
layout for an evenly spread start and 0.40 pixels for a clustered start.
The corresponding shifts with a single center were 3.67 and 3.47 pixels.

| Starting points | Distant push | Full tick median | Full tick p95 | Density difference at tick 200 |
| --- | --- | ---: | ---: | ---: |
| Evenly spread | Current, per point | 47.1 ms | 58.0 ms | Reference |
| Evenly spread | Cell center | 40.3 ms | 60.1 ms | 3.05% |
| Evenly spread | Four corners | **38.4 ms** | 61.6 ms | 1.20% |
| Two dense clusters | Current, per point | 46.3 ms | 56.6 ms | Reference |
| Two dense clusters | Cell center | 36.0 ms | 56.4 ms | 2.95% |
| Two dense clusters | Four corners | **36.9 ms** | 53.5 ms | 0.89% |

Each time is the median of the corresponding statistic from three runs.
The 95th percentile for evenly spread frames rose from 58 to about 62 ms
with four corners. All 18 timed runs kept finite positions, flags and fixed coordinates,
and all 999,998 free points moved. The four-corner field added 174,080 bytes
to the tracked hierarchy buffers (87,040 bytes for the center field).

The density images showed similar outlines, including the initial ring and
later filled disk. The density difference is half the sum of the absolute
bin-count differences divided by the number of present points. Repeating
the current solver itself gave 0.11% and 0.15% final density difference.
The largest individual four-corner shifts in the sample were 2.01 and 0.78
pixels. The clustered start dispersed quickly under the chain springs and
repulsion. Long-lived dense communities remain an open case.

### What happened at cell edges

On the actual moving graphs, the four-corner version stayed close to the
current solver. For points crossing 8×8 cell edges during ticks 11–50, the
95th-percentile change in the movement vector was **0.20 px** with four
corners, **0.19 px** with the current solver and **0.36 px** with cell centers
on both inputs. This compares distributions of whole-tick movement. A few
individual points can still move differently.

Frozen probes exposed a remaining discontinuity. On the 40 pairs straddling
8×8 boundaries in the clustered input, the 95th-percentile *extra* force
jump over the current solver was 12,950 force units with a cell center and
2,683 with four corners. On the uniform input the corresponding values were
1,777 and 139. The four levels contributed 530 probe pairs per distribution.
These force differences precede friction, the step cap and springs. A visual
acceptance decision still needs a graph whose clusters stay dense while points
cross these edges.

## Comparison

- Use the same deterministic chain of 1,000,000 points and 999,999 links for
  each solver, once with uniform starting positions and once with two dense
  clusters. All runs use the same point IDs, seed, flags, link order and
  200-tick cooling schedule. The clustered fixture alternates between
  clusters along the chain, so links pull the initial groups together.
- Share only the 8×8, 16×16, 32×32 and 64×64 distant shells. Finer shells
  and sampled nearby points keep the per-point evaluation. Rebuild the field
  after each tick's new GPU bounds, index, hierarchy and centroids.
- Time full moving frames on the M3 in visible Chrome at 480×340, including
  commands through GPU completion, field creation, forces, integration,
  camera fit and drawing. Exclude setup, uploads, diagnostics and compositor
  presentation. Use three cyclic run orders so each solver goes first, second
  and third. Retain the first three warmups separately, the next 197 timings,
  the median and the 95th percentile for every run.
- Require finite final coordinates and exact pinned/absent coordinates and
  flags in every run. Compare layout separately in untimed replays. At ticks
  1, 10, 50, 100 and 200 compare all present points in a common 96×96 density
  map and 4,096 stable IDs in the control camera, in pixels. Repeat the
  per-point solver to measure its own run-to-run variation. Review density
  images side by side at the same exposure, since opaque points cover each
  other in the live view.
- Probe both sides of coarse cell edges on frozen million-point inputs. Compare
  the change in the force vector across each pair with the same pair in the
  per-point solver. Count the existing solver's own edge effects separately.
  Confirm the intended interpolation numerically on an isolated distant mass.
  Speed, layout drift and edge artifacts are separate outcomes. The layout
  and seam metrics have no agreed production acceptance threshold.

In a separate untimed replay, follow the same 1,024 free point IDs every tick.
Read their actual GPU cell assignments and mark points that switch cells
between consecutive force evaluations, including changes due to the moving
grid. Measure how much each point's movement vector changes from one tick to
the next in control-camera pixels. Compare crossing and staying points at
each shared level over ticks 3–10, 11–50 and 51–200. This includes all forces.
The frozen pairs above isolate the extra jump from sharing. Retain 128
representative tracks per mode for synchronized visual playback.

## Reproduce

Use visible native Chrome on the M3. This run used Chrome 157, luma.gl
10.0.0-alpha.15, Node 24.6.0 and pnpm 10.15.0. WebGPU reported a non-fallback
Apple Metal 3 adapter and same-session WebGL identified Apple M3. From the
repository root, set `LAB_ARTIFACT_RUN` to a fresh capture name, export
`LAB_SOURCE_SNAPSHOT` with the path to the exact source archive and export
`LAB_SOURCE_REVISION` with its base commit. Then run the comparison.

```sh
LAB_NATIVE_VISIBLE=1 LAB_CELL_FIELD_STUDY=1 \
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/many-body-grid/resident-cell-field-scale.test.ts
```

Local raw captures under the lab's `captures/` directory include each run's
samples, adapter, numerical checks, density images and source snapshot.

- `shared-distant-m3-20261119/` contains the 18 timed runs, independent
  layout checks, frozen edge probes and density images. Source snapshot SHA-256
  `7a09018ed63a0d86b2ace50c60945fa4ac5c7a139d6aa8c15f594c0daf333967`.
- `shared-distant-motion-m3-20261119/` contains the consecutive-tick traces,
  the crossing/staying statistics and `motion-comparison.gif`. Source snapshot
  SHA-256 `193fc0915307072dc251321090d6cfd76183f4893bb6f8f5cb871cc42a484dab`.
- Both snapshots include the working tree and lockfile on base revision
  `d329feaffe12bfea0ea3e3f768befcb0ca0e6b4b`.
