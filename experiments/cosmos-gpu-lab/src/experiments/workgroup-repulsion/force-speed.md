# Making million-point repulsion faster

## Question

How much of the million-point repulsion cost comes from the corrected arithmetic,
and can native GPU arithmetic reduce it without a noticeable layout change?
The current no-barrier workgroup version is the control. All candidates retain
the same hierarchy, sample slots, point data and traversal; only arithmetic for
distant contributions, near neighbors, or both changes. The small workgroup
scratch remains and no 800 MB contribution buffer returns.

## Method and boundaries

- Native M3, visible Chrome and the lab's luma version. Record the actual
  WebGPU adapter, the same-session WebGL renderer, limits, source snapshot and
  dependencies. Use separate artifact directories for every run.
- Run the full force for one million points on deterministic uniform and
  clustered inputs. Use the CPU to prepare the hierarchy, centroids and eight
  selected neighbor slots, as in the earlier million-point force probe. The
  balanced shell matches the production policy at this count. No GPU grid
  construction, integration, drawing, links or full frame is timed.
- Compare fully corrected arithmetic, native far arithmetic only, native near
  arithmetic only, and native arithmetic for both. Also try an algebraic form
  that removes square roots for distances at least one, retaining the original
  softened formula at smaller distances. Compare the factorized far force alone
  and in both far and near fields. Also time diagnostic kernels
  that remove near or far work entirely. These isolated kernels may compile or
  cache differently from the complete shader, so their times are not additive
  stage measurements. Compare their recombined output with the full control.
- Compare processing targets in their original input order against grouping
  them by the finest grid cell. The diagnostic prepares that order on the CPU
  and excludes preparation from GPU timings. Positions and output identities
  stay in the original order; require every force bit to match the equivalent
  unsorted shader. A practical version would need a GPU-resident ordering and
  must account for rebuilding it as the graph moves.
- As a separate follow-up, run the existing GPU count/scan/scatter spatial
  index on normalized versions of those GPU positions. The diagnostic includes
  normalization, clearing, counting, scanning, scattering and the force in one
  GPU-timestamp interval across consecutive GPU submissions; no CPU order or
  per-tick readback is used in that interval. Validate every scattered index and membership, and require the
  resulting force bits to match the same unsorted native force. This builds a
  single-level execution order, not the hierarchy, centroids or near samples
  required for the complete force.
- Read every force output, record nonfinite values and exact differences; compare
  513 sampled targets with the unchanged scalar CPU force check. Report original
  strict failures separately from relative force error across all points, and
  retain failed candidates. Verify frozen output replay is bit-identical. Use
  three warmups, seven GPU timestamp samples per workload and rotated order.
- On smaller graphs, run independently evolving corrected and native variants
  through 200 cooling ticks with springs, gravity, center and repulsion: 8,192
  uniform community points, 16,384 clustered community points and 8,192
  uniform star points. Use 32 samples, precise shells, one pinned and one absent
  point. Record
  strict position differences, finite values, pin/absence flags, displacement in
  shared-view pixels and link-length error at ticks 1, 10, 50, 100 and 200. Save
  matched-view screenshots for visual inspection. A small number of pictures
  does not establish absence of flicker or quality across all graphs.
- There is no pre-agreed numerical threshold for perceptual similarity. The
  existing strict tolerance is unchanged; visual similarity and measured force
  differences are observations, not automatic production acceptance.

Use LAB_REPULSION_FAST=1 for the isolated force and
LAB_REPULSION_FAST_TRAJECTORY=1 for the graph comparison. These are exploratory
opt-in variants. The graph-size guard and production defaults remain unchanged.
Use LAB_REPULSION_GPU_ORDER=1 for the GPU-built ordering and force diagnostic.
To inspect a small live case, select an experimental native-arithmetic option
under **WebGPU repulsion** and press **Step + validate**.

## Findings

On an Apple M3, grouping nearby targets on the GPU made the isolated native
force substantially faster for the uniform million-point input. The GPU first
builds an execution order by grid cell, then calculates each point's force in
that order. Point identities and the order of each point's contributions stay
the same. The grouping produced exactly the same force bits as the **ungrouped
native** shader for both inputs, including on replay.

These are GPU timestamp medians and observed ranges, in milliseconds, from
three warmups and seven samples per run. The combined time includes building
the single-level GPU order and calculating the force, with two consecutive GPU
submissions and no CPU readback between them. Hierarchy, centroids and neighbor
slots were prepared on the CPU before timing; this is not a graph frame time.

| Input | Ungrouped native force | GPU order + native force | Repeat: ungrouped | Repeat: GPU order + force |
| --- | ---: | ---: | ---: | ---: |
| Uniform, 1 million points | 121.7 (107.2–458.3) | 21.3 (15.0–300.9) | 111.9 (108.1–615.6) | 24.9 (15.5–195.3) |
| Clustered, 1 million points | 13.4 (11.3–16.3) | 12.4 (11.1–15.7) | 14.7 (13.1–16.2) | 14.2 (11.9–15.2) |

The large uniform timing spikes occurred in both runs, including the ungrouped
control. Their cause is unknown, so consistent interactive performance has not
been established. Building the single-level order alone had medians of 1.9–2.1
ms for uniform inputs and 0.9–1.0 ms for clusters across the two runs. That
index used 7.15 MB plus 8 MB for normalized positions; these figures do not
include the rest of the graph. Initial and final index checks found no missing,
duplicate or incorrectly placed indices.

The speedup also depends on using native arithmetic instead of the current
rounding-corrected shader. In a separate same-input run without grouping,
corrected versus native medians were 378.7 versus 135.2 ms for uniform points
and 123.6 versus 15.0 ms for clusters. A simplified, factorized formula measured
127.6 and 14.3 ms respectively, but its sample ranges overlapped native; this
does not establish a further speedup.

Grouping preserves the native result, **not** the corrected result. Against the
existing strict tolerance, native arithmetic failed two force components among
513 sampled clustered points and none among 513 sampled uniform points. Across
all million-point outputs it differed beyond that tolerance from the corrected
GPU result in 1,505 uniform and 1,538 clustered force components. In separately
evolving 200-tick layouts, the 8,192-point star had native positions displaced
by 1.60 pixels RMS, with a 14.48-pixel maximum, in a shared 480 × 340 view;
2,193 of 8,191 present points moved by more than one pixel. The matching
screenshots look broadly similar at that scale, but point-level differences may
matter when zooming or interacting. The two community cases showed much smaller
displacements. These tests do not establish visual acceptance for other graphs.

An earlier, preliminary version put index construction and force in one GPU
submission and repeatedly lost the device; the reported Metal message included
“Insufficient Memory.” Those preliminary runs did not retain exact source
snapshots and the cause was not established. The two-submission version completed
the checks above; that does not prove the failure cannot recur.

The experiments used visible Chrome 157, luma.gl 10.0.0-alpha.15, a non-fallback
Apple WebGPU adapter reporting Metal 3, and a same-session WebGL renderer
identifying Apple M3. Raw results and exact source snapshots are retained under
the lab's ignored `captures/` directory; the snapshots include the deterministic
input generators:

- `repulsion-gpu-order-m3-20261118/` and
  `repulsion-gpu-order-m3-repeat-20261118/`: GPU ordering and force. Both use
  the first directory's `source-snapshot.tar.gz` (SHA-256
  `abdb4a783bf99c5f33ae288852ce51bba88744d8ceec20ea951bb3a42d6112d8`).
- `repulsion-factorized-m3-20261118/`: arithmetic and force checks, with
  `source-snapshot.tar.gz` (SHA-256
  `ea602c7f1e87083aa5136c9969cb1addd8d04cf2912963431bec3cd66b95845d`).
- `repulsion-factorized-trajectories-m3-20261118/`: independent layouts and
  matched screenshots, using the factorized run's snapshot.
- `repulsion-gpu-order-smoke-20261118/`,
  `repulsion-gpu-order-smoke-retry-20261118/` and
  `repulsion-gpu-order-loss-detail-20261118/`: preliminary device-loss runs,
  without exact snapshots.

The follow-up [moving million-point graph](#/million-graph) builds the hierarchy
and sample slots on the GPU and includes links and drawing. The existing full
WebGPU viewer still has its size guard; neither investigation approves migration.
