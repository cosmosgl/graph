# Acceptance scope for the WebGPU investigation

The first decision is for a native WebGPU adapter on Apple M3 in visible
Chrome. Record the browser, adapter, luma version, source and input identity
in each replay. Use 961 × 541 CSS pixels at DPR 2 for the moving performance
runs, with the whole canvas visible. Validate visual behavior at DPR 1 and 2.
The device and browser coverage for a public release needs its own evidence.

## Workloads

| Graph | Points | Links | Hub workload |
| --- | ---: | ---: | --- |
| Dense communities | 1,000,000 | 999,990 | Eight communities, largest source group 65 |
| Communities with a hub | 1,000,000 | 999,990 | One free hub with 8,192 source-grouped links |
| YouTube friendships | 1,000,000 | 2,852,734 | Five largest degrees 28,754, 14,641, 11,281, 10,461 and 8,953 |

The YouTube fixture adds real undirected relationships with several large hubs.
The [Stanford SNAP source](https://snap.stanford.edu/data/com-Youtube.html) has
1,134,890 nodes and 2,987,624 links. Keep the highest-degree million original
IDs, breaking ties by ascending ID. Keep every link between the retained IDs,
in input order. Store the original IDs alongside their compact indices. The
largest retained source group has 28,576 links. Start with the Lab's seeded
uniform positions, unit link weights and two-pixel points. Use separate
pinned, absent and update cases to test the identity contract.

Keep the downloaded source in the Lab's ignored `captures/fixtures/` folder.
Run `node experiments/cosmos-gpu-lab/scripts/prepare-youtube-fixture.mjs` from
the repository root to create the binary fixture. Its SHA-256 is
`1b4f834c6acf374905934cc4fd65ded5ef8116fd73016db5e15ee8177da0f8b5`.
The script checks the [source archive](https://snap.stanford.edu/data/bigdata/communities/com-youtube.ungraph.txt.gz)
and prints the fixture hash and actual degree counts.

For the first real graph run, use Four corners, Reduced drawing and the
unchanged browser scheduler. Record eight warmup ticks and 48 steady
intervals or stop after 45 seconds and retain partial frames. Time startup
from the in-memory fixture, with download, digest and fixture construction
outside the measurement. Read position invariants after timing.

```sh
LAB_NATIVE_VISIBLE=1 VITE_LAB_RESIDENT_REAL_GRAPH=1 \
  pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/million-graph/resident-real-graph.test.ts
```

Use the Lab's source and capture variables for each replay.

The first M3 run rendered the 1,000,000 points and 2,852,734 links in
802 ms from in-memory input. Peak sampled GPU allocation was 260.2 MiB.
The steady interval p95 was 51.9 ms, with just 1/48 intervals within 33 ms.
All points moved and the final positions were finite. This native Chrome 157
run used the Apple Metal 3 adapter and luma 10.0.0-alpha.15. The results are in
`captures/resident-youtube-m3-20261120-040053/` with source archive SHA-256
`df386359d7dc437273aaecad184f2ecf319f824e6f1b030caaf8489bf01cb9bf`.
This initial run covers basic styles, startup and steady motion.

Retain the 8,192-point full-force community as a correctness control. Scale
gravity, global centroid, repulsion, weighted springs, cluster attraction,
per-point attractors, mouse repulsion and hashed collision together. Include
two collision passes, held and released pointer input, cell crossings, long
cooling, reheating and topology changes. Retain force-by-force timings.

Start motion and picking comparisons with circles and solid straight links.
Exercise the point shapes, fractional size and zoom, subpixel coverage, color,
opacity, strokes, icons, rings, highlight, drawing order and occlusion. Check
straight and curved links with end caps, fractional widths, gradients,
dash/dot patterns, arrows, distance opacity, hover and focus. Include thin and
faint objects and overlapping point and link picks.

## Acceptance before comparisons

| Area | Working target on M3 |
| --- | --- |
| Steady motion | At least 95% of consecutive moving graph frame intervals ≤33 ms. Measure actual completed updates and retain missed opportunities. |
| Picking | Every pick ≤50 ms from input to highlighted frame and the next animation opportunity. Include background and overlapping objects. |
| Startup | First usable graph frame ≤2 s after the application hands over in-memory arrays, including upload and cold pipeline setup. Record warmed startup separately. |
| Updates | Whole-graph point and topology replacement visible ≤2 s. Incremental position or style edits visible ≤50 ms. Time from the application call through the next animation opportunity with the result. |
| CPU consumers | Area selection available ≤100 ms after the request. For 1,000 tracked coordinates, at least 95% of label updates within 33 ms. Check snapshot identity across graph, point and camera changes. |
| Memory | Peak app-owned GPU buffers and textures ≤512 MiB, including resize, updates and allocations that coexist during replacement. Report browser or driver memory separately when observable. |

Keep steady, input, update and startup windows separate. Repeat passing timing
lanes in a fresh browser session. Log all failed lanes, including the pilot's
[68.2 and 100.4 ms pick stalls](#/pilot-viewer?section=doc-findings).

Use the [practical rendering rules](#/validation-workflow?section=first-migration-rules)
of one backing pixel at boundaries and 2/255 channel error in interiors.
Point/link IDs, endpoints, weights, pinned positions and absent state must
match exactly. Points and links must stay selectable by visible geometry and
the declared overlap order.

For layout, inspect paired motion and settled views at Fit and 3×. Include
dense groups, large hubs and points crossing cell boundaries. Reject visible
cell-edge jumps, persistent extra overlaps, collapsed groups or materially
different hub neighborhoods. On matched one-tick probes, allow at most one
backing pixel of extra displacement at the declared zoom. Record numerical
stress, overlap counts and residual motion alongside the visual review. Keep
independent solver checkpoints and long-run layout quality as separate results.

## Integration checks

Run the actual `Graph` setters, topology replacement, shrink and regrowth,
point and link transitions, simulation callbacks, dragging, Fit and resize.
Exercise async rectangle and polygon selection and tracked positions from
their real UI callers, including a pending request during replacement.

Exercise the full `Graph` and Deck layer on one supported luma version. Check
the borrowed-device draw and pick passes, cleanup, unexpected loss during
motion, recovery and the experience when WebGPU is unavailable. Update the
[roadmap](#/roadmap) with the measured limits and remaining release gates.
