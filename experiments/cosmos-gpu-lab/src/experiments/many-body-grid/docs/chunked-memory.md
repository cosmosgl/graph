# Bounded repulsion scratch

## Question

Can the streamed far-field force reuse a fixed-size contribution buffer while
preserving the existing grid, force, integration and numerical checks? Does the
resulting memory budget fit one million points on the current M3, and what
other work prevents a complete million-point graph?

## Candidate and boundary

The existing streamed implementation stores up to 100 float32 XY contributions
per target for one grid level: `points × 100 × 8` bytes. The candidate processes
a bounded group of targets, accumulates their contributions, and reuses the
same scratch for the next group. Target positions and the running sum retain
global point indices; only the temporary scratch uses chunk-local indices.
Each level and target uses the same cell traversal and arithmetic as the
existing streamed control. The original per-level cumulative sums remain
available for tracing.

Each producer and consumer is a separate GPU dispatch; all work stays resident
on the GPU. WebGPU treats each dispatch as a separate
[resource usage scope](https://www.w3.org/TR/webgpu/#synchronization).
Immutable per-chunk and per-level uniforms select work without reusing a
mutable uniform before GPU submission. Chunking increases dispatch count:
`2 × levels × ceil(points / chunkSize)`, plus the centroid dispatch.

The candidate is opt-in and retains the existing 16,384-point execution guard.
It is not a replacement for the complete graph backend or a production feature.

## Checks and timing

- Compare the original streamed and chunked versions on identical uniform,
  clustered, coincident, edge, pinned and absent fixtures. Cover short and
  partial chunks, more than one chunk, and point-count shrink/grow.
- Preserve the existing independent CPU structure, centroid, force and
  integration checks. For both GPU versions, also compare all grid, centroid,
  force and position bits. A finite result alone is not a pass.
- On visible Chrome and the native M3, benchmark frozen 8,192- and 16,384-point
  uniform and clustered inputs using eight samples and the precise shell.
  Compare the original buffer with chunk sizes 1,024, 4,096, 8,192 and 16,384.
  Use one GPU step per sample, three warmups and seven measured samples,
  rotating order. Rendering and validation readbacks are outside the GPU
  interval. Report GPU medians, ranges and CPU submission separately.
- Suppress an accepted timing summary if a structure, centroid, original CPU,
  bitwise replay or timer check fails. Keep raw failures and warmups.

## One-million-point memory probe

For one million deterministic uniform points, estimate the large buffers in the
current grid/base-position design, using seven hierarchy levels, eight neighbor
samples and a 16,384-target chunk. Check each planned storage binding against
the created device's limits, allocate those major buffers simultaneously and
touch one word per 4 KiB page on the GPU. This is an allocation probe only:
graph topology, spring buffers, drawing, driver memory and a real simulation
are not included. Allocating buffers does not establish full-graph viability.
While those buffers remain allocated, also allocate and touch scratch buffers
for 65,536- and 131,072-target chunks if device limits allow. Their dispatch
counts are calculated; this does not time the million-point force.

Separately count dense-cell fallback iterations using the CPU reference's
float32 cell assignment and the same point fixture. This is a model of loop
work, not a GPU timing; boundary rounding can change cell membership. The
existing cached-small builder scans every source for each cell containing more
than 32 points. If the model exceeds 500 million source iterations, do not run
that existing million-point builder as part of this probe. Report the estimate
and leave full-scale execution untested. The current corrected centroid divide
also has a separately documented 16,384-count validation envelope; removing
the input guard does not validate larger cell counts.
The optional `LAB_REPULSION_DIVIDE=1` diagnostic replays the existing centroid
division shader against float32-rounded CPU division for boundary and seeded
counts from 16,385 through one million. It records exact output-bit mismatches;
the sampled corpus is not exhaustive coverage of every input and count.

As a separate possible building block, test the lab's existing count/scan/scatter
spatial index at one million normalized points with uniform and clustered
inputs, a 512 × 512 grid, three warmups and seven GPU-timestamped builds.
Validate every count, offset and scattered membership before and after timing.
The GPU interval starts after the clear pass and covers count, scan, the cursor
copy and scatter. This index has unstable order inside each cell and does not
implement the repulsion hierarchy, source-order sums, neighbor selection,
absence handling or forces. It is evidence for a primitive, not a replacement
or a full-graph performance result. Enable it with `LAB_REPULSION_CSR=1`.

Use `LAB_REPULSION_CHUNK=1` for the bounded timing and
`LAB_REPULSION_MEMORY=1` for the memory/occupancy probe. Keep the visible
browser for timing, record its actual adapter and limits, and use a clean source
revision or an exact snapshot plus a unique `LAB_ARTIFACT_RUN`. Raw captures
stay in ignored `captures/`. Never infer million-point graph speed from the
buffer probe or the smaller frozen workloads.

## M3 findings · 18 November 2026

Chunked scratch preserves the checked force while reducing the working buffer.
For one million points, a 16,384-target chunk needs **13.1 MB** of contribution
scratch instead of **800 MB**. The separate per-level sums still need 56 MB.
The probe allocated and touched the planned major repulsion/base buffers
simultaneously: **210.5 MB total**, excluding graph links, spring resources,
rendering, temporary readbacks and driver overhead. This is not a full graph run.

Larger chunks trade memory for fewer dispatches. Additional 52.4 MB and
104.9 MB scratch buffers also allocated and were touched while the base plan
was live. At one million points, chunk sizes 16,384, 65,536 and 131,072 imply
869, 225 and 113 extra dispatches respectively, including centroid creation.
Those dispatch counts are calculations, not measured million-point force times.

At 16,384 points, all timed variants passed the unchanged CPU checks and matched
the streamed GPU force and position bits. Times are median GPU milliseconds
for a frozen simulation step, not an interactive frame:

| Variant | Scratch | Uniform | Clusters | Extra dispatches |
| --- | ---: | ---: | ---: | ---: |
| Original streamed | 13.11 MB | 8.50 ms | 10.99 ms | 13 |
| Chunk 1,024 | 0.82 MB | 21.68 ms | 23.75 ms | 193 |
| Chunk 4,096 | 3.28 MB | 9.68 ms | 11.94 ms | 49 |
| Chunk 8,192 | 6.55 MB | 9.01 ms | 11.46 ms | 25 |
| Chunk 16,384 | 13.11 MB | 8.35 ms | 10.85 ms | 13 |

The 1,024-target chunk was substantially slower in this run. The ranges of the
larger chunks overlap the original, so their small median differences are not a
reliable speed ranking. CPU submission medians at 16,384 uniform points ranged
from 0.3 ms for the original to 2.8 ms for the 1,024 chunk. The results do not
predict million-point frame rates. The chunked version also matched the original
GPU outputs for ten independent combined-graph ticks at 8,192 and 16,384 points,
including one pinned and one absent point. The existing graph cap is unchanged.

The million-point CPU-model occupancy analysis found **17,306 dense cells** for
the current 32-point sort threshold. Their fallback would perform about **17.3
billion source-loop iterations** for this uniform fixture. This is a modeled
work count, not a measured GPU duration. It exceeds the declared stop threshold,
so the old builder was not run at one million. A one-million-point graph still
needs a scalable hierarchy builder and validation of its force and interaction
behavior.

The separate count/scan/scatter spatial-index primitive did build one million
uniform and clustered normalized points on this device. All counts, offsets and
memberships passed exhaustive checks before and after timing. Its GPU medians
were **2.08 ms** for uniform and **1.76 ms** for clusters, excluding the clear
pass; the index used 7.15 MB in addition to 8 MB of positions. This is a
single-level index without the repulsion aggregates, ordered sums, sampling or
forces; integrating it remains work, and intra-cell scatter order is unstable.

For centroid arithmetic, 32,864 sampled divisions with denominators from
16,385 through one million matched float32-rounded CPU output bits on this M3.
This is useful evidence beyond the previous test envelope, not exhaustive
validation for every input or a reason to remove the graph cap by itself.

The WebGPU adapter reported Apple/metal-3 and non-fallback but did not expose
its chip model; the same sessions' WebGL renderer identified Apple M3. Visible
Chrome 157 and luma.gl `10.0.0-alpha.15` were used. Raw artifacts remain in
`captures/repulsion-chunk-timing-m3-20261118/`,
`captures/repulsion-memory-alternatives-20261118/`,
`captures/repulsion-csr-m3-20261118/` and
`captures/repulsion-division-m3-20261118/`, with their recorded source
snapshots. Earlier precision findings remain in
[Precision cost](#/many-body-grid?section=doc-precision-cost-preserving-precision-with-less-memory).
