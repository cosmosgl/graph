## Fresh pointer picking at one million points

At the center of the million-point hub fixture, WebGPU spent 4.06 ms drawing the point pick window and another 4.06 ms drawing the link beneath it. Clearing an empty window took less than the GPU timer resolution. The same costs appeared over the isolated link and empty background. A fresh click submitted four vertices for each of one million points and 999,990 links, regardless of how many could reach the pointer.

On M3, filtering the live positions and rasterizing the surviving instances in their original order reduced GPU time at all four locations. A point anywhere in the pick window takes precedence over the link. For a positive-size pointer sprite centered strictly inside the window, its minimum radius of one pick texel guarantees that it covers a sample. In that case the GPU can omit the link draw. The normal point shader still decides which point wins.

| Median GPU time at tick 58 | Point 0 | Link 999,989 | Background | Crowded Point 984,615 |
| --- | ---: | ---: | ---: | ---: |
| Original signed WebGPU | 8.13 ms | 8.13 ms | 8.13 ms | 9.50 ms |
| First-to-last candidate range | 1.31 ms | 1.38 ms | 1.28 ms | 10.58 ms |
| Ordered candidates with point priority | 1.41 ms | 1.44 ms | 1.34 ms | 2.72 ms |

The first draft still drew almost every instance when the first and last candidates were far apart in draw order. The ordered list removed those gaps. With the final prototype, the fresh renderer query through readback took 2.20–2.35 ms over the first three targets and 3.55 ms over the crowded point. Small graphs, transitions, curved or unblended links, and host-supplied draw passes keep the original raster path.

For this diagnostic only, the final pinned edge connects Point 0 to the first community anchor, is 6 CSS pixels wide, and that anchor comes last in point order. Each real package click returned the expected ID. The timing harness takes six GPU samples per target after two warmups, rotates the targets and draw masks, and includes the filtering passes in the GPU totals. Replay it with `node experiments/cosmos-gpu-lab/scripts/profile-packaged-pick.mjs --bundles NAME` from the repository root. The signed, range and final prototype captures are `pointer-pass-2026-11-26T12-53-55-798Z`, `pointer-pass-2026-11-26T12-54-08-186Z` and `pointer-pass-2026-11-26T13-02-52-805Z` under `captures/`. The official release comparison below uses the original edges and point order and times the first visible frame.

### Original fixed-tick release comparison

The clean tarball from `12c2b599` (`c7c523be`) and the WebGL control (`74a216a7`) ran the original dense and hub fixtures. Both WebGPU first clicks now produced visible feedback within one display interval in each engine order. The hub passed the 4.175 ms relative allowance in both orders. The dense result remains **unassessed** because the paired outcomes disagreed.

| First trusted click at tick 58 | WebGL callback | WebGPU callback | WebGL visible | WebGPU visible | Relative result |
| --- | ---: | ---: | ---: | ---: | --- |
| Dense, WebGL first | 6.5 ms | 9.5 ms | 8.2 ms | 14.2 ms | 6.0 ms over WebGL |
| Dense, WebGPU first | 7.9 ms | 7.8 ms | 15.5 ms | 14.4 ms | Within allowance |
| Hub, WebGL first | 12.5 ms | 9.2 ms | 15.7 ms | 14.8 ms | Within allowance |
| Hub, WebGPU first | 12.3 ms | 8.3 ms | 12.5 ms | 14.3 ms | Within allowance |

In the first dense order, 3.0 ms of the 6.0 ms difference elapsed before the callback and 3.0 ms between callback and visible feedback. The second dense order reversed the end-to-end result. All 144 trusted clicks, ordered endpoints, fixed points, absence and public edits passed. Peak tracked allocation was 418.6 MiB on WebGL and 273.2 MiB on WebGPU, and every device released its tracked allocations. Resize passed on both topologies, as did dense topology updates. The steady frame and click p95 comparisons remained unassessed because paired WebGL results drifted. All predeclared metrics, original inputs, controls, orders and package hashes are in `captures/packaged-force-timing-2026-11-26T13-08-14-368Z/`.

### Dense clicks across the refresh interval

When the cursor has settled, WebGL dispatches the hover ID and coordinates it already holds. WebGPU makes a fresh query for each click. At million-point tick 58, this difference was visible even with the two engines receiving input across the same four quarters of the refresh interval.

| Repeated release | WebGL callback | WebGPU callback | WebGL visible | WebGPU visible |
| --- | ---: | ---: | ---: | ---: |
| Point 0, WebGL first | 0.46 ms | 7.09 ms | 8.81 ms | 13.96 ms |
| Point 0, WebGPU first | 0.59 ms | 6.94 ms | 8.63 ms | 15.37 ms |
| Background, WebGL first | 0.45 ms | 5.89 ms | 9.30 ms | 14.55 ms |
| Background, WebGPU first | 0.60 ms | 5.97 ms | 9.10 ms | 15.23 ms |

The 48 WebGPU point releases each made one fresh pick followed by one coordinate read. Median durations in the two orders were 5.20 / 5.25 ms for picking and 1.40 / 1.30 ms for coordinates. Background releases needed only the pick, with medians of 5.45 / 5.50 ms. This measures the part a combined fresh ID-and-coordinate result could save. Reusing hover can return the wrong ID after the application changes the projection.

Each of the four fresh sessions alternated the original point and background, placed mouse-down before the scheduled release, and held the graph at tick 58. All 192 releases were trusted and correct. Each target received six requested releases per quarter, with the order rotated across repetitions. Actual phases were measured from the most recent animation-frame timestamp. All four quarters were represented in each session and target. The table weights their measured means equally and retains off-target arrivals. The graph stayed still while the input waited, so the first-click qualification remains the comparison in the preceding section. Replay with `--matched-ticks --click-phases --fixture dense --points 1000000 --bundles NAME` on the packaged force benchmark. The requested and observed phases, method durations and retained inputs are in `captures/packaged-force-timing-2026-11-26T13-19-14-895Z/`.

### Direct mapping of the pointer snapshot

The pointer read copies its texture into a 2,560-byte buffer. On luma.gl 10.0.0-alpha.14, reading a buffer created with `COPY_DST | COPY_SRC` allocates a temporary mappable buffer and submits another copy. An isolated build changed that destination to `COPY_DST | MAP_READ`. Its unmodified source first rebuilt byte for byte against the shipping candidate.

Four M3 Chrome sessions ran the signed and trial bundles in opposite orders. Within each session, every target used both buffer settings in alternating order for 32 pairs. The extra allocation disappeared on all 512 directly mapped reads. All 1,024 fresh queries and 16 trusted public clicks returned the expected point, link or background. Across the 16 target/session combinations, the median reduction was 0.00–0.10 ms for the read and 0.00–0.15 ms for the full query, with zero median improvement in several cases. The release keeps the qualified buffer usage. The isolated bundle, replay, complete result references and per-order figures are in `captures/cosmos-direct-pick-read-4k339df1/`.

### Clicks while the signed graphs keep moving

With the ordinary animation loops running, both packages returned the requested point or background for all 144 trusted clicks. Across the two engine orders the first visible WebGPU response averaged 182.4 ms on dense communities and 281.9 ms on hubs. At the fixed simulation tick above it took 14–15 ms. The live figures include outstanding simulation and rendering work. They describe what an application experiences while the graph moves.

| M3 with a million points | Dense WebGL / WebGPU | Hub WebGL / WebGPU |
| --- | ---: | ---: |
| Steady frame p95 | 333.2 / 185.0 ms | 425.4 / 275.0 ms |
| First visible click | 995.1 / 182.4 ms | 1,107.8 / 281.9 ms |
| Click p95 (slowest of 12) | 995.1 / 274.1 ms | 1,107.8 / 297.9 ms |
| Cold startup | 563.4 / 437.5 ms | 655.5 / 431.4 ms |
| Topology replacement | 351.6 / 273.4 ms | 441.3 / 289.4 ms |
| Peak tracked allocation | 418.6 / 273.2 MiB | 418.6 / 273.2 MiB |

Memory met its margin on both graphs, as did dense cold startup and topology replacement. Relative frame and click timing remain unassessed under the declared comparison rule. For example, dense WebGL control frame p95 was 318.2 and 318.1 ms. In the two paired trials it was 316.6 and 349.8 ms. Hub control click p95 ranged from 1,040.4 to 1,544.2 ms. Every trial preserved the pinned positions, missing slot and ordered endpoints, performed all four edits, and returned tracked GPU allocations to zero. The exact two packages, individual events, control thresholds and verdicts are in `captures/autonomous-million-12c2b599-20261126/`.

## Signed million-point packages before pointer filtering

The release candidate at `e8fa6c3b` used the actual Graph tarball's standalone distribution (`b52a9c7f`, luma.gl 10.0.0-alpha.14) and the WebGL reference (`74a216a7`, luma.gl 9.3.6). The full package hashes and tarballs are in `captures/signed-graph-deck-release-xr98e9r4/`. Each number below is the average of the two paired trials, ordered WebGL / WebGPU. “A/A spread”, “WebGL drift” and “mixed orders” identify why a comparison remained unassessed.

### Default autonomous graph

All 144 real clicks returned pinned Point 0 or background as requested, and all four public edits and their checks passed. Cold startup and peak tracked allocation met their margins on both topologies. The hub's full data replacement also met its margin. Relative frame speed and live-click latency remain unassessed.

| Metric | Dense WebGL / WebGPU | Dense verdict | Hub WebGL / WebGPU | Hub verdict |
| --- | ---: | --- | ---: | --- |
| Frame p95 (ms) | 501.3 / 358.4 | WebGL drift | 525.7 / 308.3 | WebGL drift |
| First click (ms) | 1,311.5 / 465.3 | A/A spread | 1,198.8 / 406.4 | A/A spread |
| Click p95 and slowest of 12 (ms) | 1,686.9 / 539.9 | A/A spread | 1,317.6 / 523.9 | A/A spread |
| Cold startup (ms) | 561.0 / 435.5 | Within margin | 569.4 / 442.8 | Within margin |
| Point update (ms) | 135.9 / 139.1 | A/A spread | 118.9 / 98.1 | A/A spread |
| Topology update (ms) | 445.5 / 332.3 | A/A spread | 434.1 / 307.3 | A/A spread |
| Full replacement (ms) | 715.3 / 558.3 | A/A spread | 641.6 / 608.6 | Within margin |
| Resize (ms) | 71.8 / 61.8 | WebGL drift | 74.5 / 69.3 | WebGL drift |
| Peak tracked GPU allocation (MiB) | 418.6 / 265.2 | Within margin | 418.6 / 265.2 | Within margin |

The first click arrived at tick 63 or 64 on WebGL and 59 on WebGPU. By the edits WebGL had reached ticks 119–127 and WebGPU 97–99. Dense WebGL controls agreed on steady frame p95 at 549.9 / 550.0 ms, but their click p95 differed by 306.6 ms. Hub control click p95 differed by 708.0 ms. The live loop continued submitting work while physical input was dispatched. macOS reported fair thermal pressure at all lane boundaries with low power mode off. Raw intervals, event times, actual input ticks and all control limits are in `captures/packaged-force-timing-2026-11-26T12-02-02-376Z/`.

### Host-driven frames and fixed-tick input

All 144 trusted clicks returned the expected ID. Every trial completed ticks 8–56 consecutively, dispatched and resolved the alternating clicks on ticks 58–80, and paused at tick 80 for edits. Both packages produced all four requested updates, retained every pin and ordered link endpoint, and returned their tracked GPU memory to zero.

| Metric | Dense WebGL / WebGPU | Dense verdict | Hub WebGL / WebGPU | Hub verdict |
| --- | ---: | --- | ---: | --- |
| Frame p95 (ms) | 417.9 / 300.8 | A/A spread | 468.2 / 316.5 | A/A spread |
| First click (ms) | 14.4 / 32.4 | Slower | 15.0 / 30.9 | Slower |
| Click p95 and slowest of 12 (ms) | 65.4 / 34.5 | WebGL drift | 56.1 / 33.7 | Within margin |
| Point update (ms) | 149.7 / 99.9 | Within margin | 183.0 / 99.9 | WebGL drift |
| Topology update (ms) | 390.2 / 399.9 | WebGL drift | 382.3 / 400.0 | WebGL drift |
| Full replacement (ms) | 567.1 / 559.4 | WebGL drift | 651.7 / 566.9 | WebGL drift |
| Resize (ms) | 65.8 / 67.6 | Within margin | 66.2 / 66.6 | Within margin |
| Peak tracked GPU allocation (MiB) | 418.6 / 265.2 | Within margin | 418.6 / 265.2 | Within margin |

**The idle edit and stationary pointer each do less work.** The packaged hub traces below establish two full canvas draws for the edit and one fresh click pick. The full timing block still found an extra display interval for the first click in both orders. For example, the dense WebGPU callbacks took 17.8 and 18.6 ms from the trusted click, followed by 14.6 and 13.7 ms to the visible feedback opportunity. The matched hub topology measurement fell from 431.9 ms before the fixes to 400.0 ms on the signed candidate. Paired WebGL drift leaves its comparative verdict open.

The first dense control overlapped a short repository lint hook during Chrome startup. All 12 trials are included. macOS reported nominal thermal pressure at first and fair pressure by the end of the second control. Subsequent trials stayed at fair and low power mode was off throughout. Dense paired WebGL frame p95 still ranged from 318.0 to 517.9 ms under the same reported pressure and at the same ticks. These system readings do not isolate a cause. Raw records and exact served bytes are in `captures/packaged-force-timing-2026-11-26T11-49-46-177Z/`.

A separate prototype combined the hit ID and point coordinates in one read. It returned Point 0 at tick 58 with one GPU submission after the DOM click. Compared with the earlier two-submit trace, the time from DOM click delivery to the public callback changed from 11.0 to 10.0 ms. The next display opportunity arrived 14.8 ms later in the prototype run and 0.9 ms later in the two-submit run. The recorded end-to-end times were 29.2 and 16.0 ms respectively. The signed tarball uses the two-submit path. The isolated prototype probe is in `captures/packaged-force-timing-2026-11-26T12-01-33-032Z/`.

Another prototype reused a completed hover for clicks at the same pixel. In a trusted-input SwiftShader check, the app hovered point 0, changed its simulation space size to 8,192 and drew 14 frames. The old red pixel visibly became background. The position-buffer version stayed at 1, so the draft still returned point 0. The signed WebGPU package freshly picked background. Changing the coordinates received by a hover callback also changed the coordinates of a later draft click. Both real packages returned the actual point position in that case. The release candidate retains fresh picking. The five cases for each of the three builds, their package hashes and the isolated draft are in `captures/cached-hover-audit-20261126/`.

## Earlier 8,192-slot timing blocks

On Apple M3, both packages returned the correct target for all **288 native clicks** in two independent timing blocks. WebGPU click feedback stayed within the predeclared margin on both 8,192-slot graphs. WebGPU frame p95 ranged from 17.6 to 17.7 ms in every paired trial. The WebGL frame controls varied enough to leave **relative frame speed unassessed** on both topologies.

| Topology and block | Frame p95, WebGL / WebGPU | Click p95, WebGL / WebGPU | Click p95 change | First click, WebGL / WebGPU | Worst individual click, WebGL / WebGPU | Click allowance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dense communities | 32.35 / 17.60 ms | 19.60 / 16.60 ms | −3.00 ms (−15.3%) | 15.80 / 15.10 ms | 21.9 / 16.8 ms | 4.18 ms |
| Dense, repeat | 25.40 / 17.60 ms | 18.75 / 16.15 ms | −2.60 ms (−13.9%) | 16.15 / 14.35 ms | 21.0 / 16.3 ms | 4.18 ms |
| Hub | 25.50 / 17.65 ms | 17.00 / 15.80 ms | −1.20 ms (−7.1%) | 15.60 / 13.70 ms | 17.0 / 16.0 ms | 4.18 ms |
| Hub, repeat | 33.15 / 17.60 ms | 17.05 / 16.85 ms | −0.20 ms (−1.2%) | 16.35 / 11.85 ms | 17.2 / 16.9 ms | 4.16 ms |

Frame p95, click p95 and first click average the two comparison trials per engine. The worst individual click is the largest across those two trials. At twelve clicks per trial, the nearest-rank p95 is the slowest click in that trial. Every one of the 8,064 free points moved in each session. Pins and absence stayed exact. Each topology used the same input hashes and settings throughout.

### What the frame windows measured

Each fresh foreground Chrome session ran one standalone Graph package in a 961 × 541 CSS canvas at DPR 2. Both packages used the seeded inputs, camera, styles and forces from the Lab comparison and ran their own render loops. The benchmark measured idle refresh before loading the package. A microtask following each simulation tick placed a public luma fence after the frame’s draw had submitted. At each animation opportunity, the observer checked fence readiness and recorded the latest completed frame. It counted earlier submissions that finished in the same opportunity as coalesced. The resulting interval includes submission, GPU completion, browser scheduling and the presentation opportunity.

After eight warm-up frames, each trial recorded 48 intervals. At this sample count the third-slowest interval sets p95. A WebGL trial that missed one or two refresh opportunities often had p95 near 17.6 ms. Missing three usually moved it to roughly 33 ms. WebGPU missed zero in all eight paired windows. Its worst individual interval was 17.7 ms. WebGL’s worst was 33.9 ms on dense and 49.5 ms on hub. Full position readbacks ran before motion and after the final timed interaction.

| Topology and block | WebGL control frame p95, trials 1 / 2 | WebGL then WebGPU frame p95 | WebGPU then WebGL frame p95, shown WebGL / WebGPU | Missed opportunities, paired WebGL trials 1 / 2 | Frame verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| Dense | 17.7 / 17.6 ms | 32.3 / 17.6 ms | 32.4 / 17.6 ms | 3 / 3 | Paired WebGL drift exceeded cap |
| Dense, repeat | 17.7 / 33.4 ms | 17.6 / 17.6 ms | 33.2 / 17.6 ms | 1 / 3 | WebGL control spread exceeded cap |
| Hub | 17.7 / 32.6 ms | 17.7 / 17.6 ms | 33.3 / 17.7 ms | 2 / 6 | WebGL control spread exceeded cap |
| Hub, repeat | 17.6 / 17.6 ms | 32.9 / 17.6 ms | 33.4 / 17.6 ms | 4 / 3 | Paired WebGL drift exceeded cap |

### Click feedback and margins

Each trial alternated twelve real mouse clicks between pinned Point 0 and clear background. The pointer dwelled for two completed frames before each click. The normal public callback updated a visible result. The timer started at the trusted click timestamp and ended at the next animation opportunity after the update, a proxy for presentation. The captures retain the callback and feedback timestamps separately. All 288 clicks resolved within two idle refresh intervals.

Two independent WebGL controls set the margin before each topology’s WebGPU trials. Idle refresh was about 16.7 ms. The allowance was the greater of the WebGL spread and a quarter refresh, with caps of three quarters of a refresh for frame p95 and one refresh for click feedback. Both engine orders met the click allowances for first click, p95 and slowest click. [Timing decision](#/viewer-comparison?section=doc-migration-benchmark)

### Reproduction

Build both packages, then run `pnpm --filter @cosmos.gl/gpu-lab benchmark:packaged-forces` with no other GPU tests or builds active. Each block writes two WebGL controls and four paired captures per topology, including raw intervals, ticks, missed and coalesced frames, both click timestamps and feedback time. Chrome 158.0.8127.37 reported ANGLE Metal Apple M3 for WebGL and Apple metal-3, fallback false, for WebGPU. The Lab captures under `scale-forces-20261124/native-timing-fence/` and `native-timing-fence-repeat/` retain both source archives, package hashes and records.

The earlier `native-timing/` capture used the luma fence completion promise alone. On WebGL that promise polls from a timer. Checking the public fence state at each animation opportunity found 30–47 completed WebGL fences per session before their timer notifications arrived. On WebGPU the fence state follows its queue completion notification. This observer correction supersedes the earlier 44% frame-speed estimate.

## One million points

All 144 trusted clicks returned the expected pinned point or background. In all 12 Chrome processes, 984,613 free points moved, 15,386 pinned points stayed fixed, the absent slot remained empty and all 999,990 links retained their ordered endpoints. After the clicks, both packages moved the requested point, replaced link 1, restored the full dataset and drew at the requested backing size. Each device's luma GPU allocation counter returned to zero after teardown.

Each entry below gives the average of the paired WebGL and WebGPU runs, in that order. Timing verdicts use the predeclared margins and each pair's engine order. For example, the dense graph had lower observed WebGPU frame intervals, but the WebGL control spread exceeded the frame budget. Its full replacements exceeded the 4.2 ms allowance in both orders. The hub's repeatable cost increases also included startup, topology replacement and resize.

| Metric | Dense WebGL / WebGPU | Dense verdict | Hub WebGL / WebGPU | Hub verdict |
| --- | ---: | --- | ---: | --- |
| Steady frame p95 (ms) | 466.1 / 267.7 | Not assessed | 416.9 / 266.7 | Not assessed |
| First click (ms) | 1,146.2 / 405.0 | Not assessed | 1,064.0 / 367.1 | Not assessed |
| Click p95 and slowest of 12 (ms) | 1,261.1 / 424.0 | Not assessed | 1,064.0 / 433.8 | Not assessed |
| Cold startup (ms) | 561.5 / 593.8 | Not assessed | 578.8 / 596.8 | Slower |
| Point update (ms) | 131.3 / 79.9 | Not assessed | 136.9 / 96.5 | Not assessed |
| Topology update (ms) | 472.0 / 559.5 | Not assessed | 397.6 / 599.9 | Slower |
| Full replacement (ms) | 692.1 / 816.9 | Slower | 698.9 / 799.9 | Slower |
| Resize (ms) | 72.4 / 113.1 | Not assessed | 51.6 / 105.1 | Slower |
| Peak sampled GPU allocation (MiB) | 418.6 / 265.2 | Within margin | 418.6 / 265.2 | Within margin |

The initial qualification used Chrome 158.0.8127.37 on Apple M3. Both topologies' control distributions, margins, opposite-order trials and package hashes are in `captures/packaged-force-timing-2026-11-26T10-03-19-014Z/`. [Reproduction and what the timings include](#/production-forces?section=doc-scale-method)

### Rechecking full replacements and resize

On an isolated million-point dense graph, the median of three full replacements fell from 795.9 to 642.7 ms after reusing the seeded samplers. JavaScript submission fell from 696.1 to 518.7 ms, including spring topology preparation dropping from 163.9 to 85.9 ms. Consuming a pending resize in a manual draw reduced three draws to one and the first resize from 105.2 to 36.2 ms. These diagnostics are recorded in `captures/replacement-profile-20261126/`.

A fresh opposing-order block on the combined sampler and resize changes measured dense full replacement at 590.9 / 533.3 ms, within its 16.9 ms allowance in both orders. Dense steady frame p95 was 317.1 / 192.0 ms and also within margin. For the hub, full replacement was 850.1 / 733.2 ms; the paired WebGL measurements drifted beyond their control limit, leaving the comparative verdict unassessed. Dense resize was 48.4 / 54.4 ms with variable WebGL controls. Hub resize was 58.5 / 61.8 ms with mixed paired verdicts. Hub topology replacement measured 467.4 / 625.2 ms and was also unassessed. The complete block and its per-metric verdicts are in `captures/packaged-force-timing-2026-11-26T10-26-57-901Z/`.

### Final build with link-only replacements

The final block used fresh WebGL controls and paired the WebGL distribution `1b589639` with WebGPU `b5236d3c` after the engine began retaining point records for link-only changes. All 144 clicks, all original ordered endpoints and each public edit passed. Both devices again reported zero tracked GPU bytes after teardown. Hub startup and both peak allocation comparisons met their calibrated margins. Other timings remain unassessed because paired measurements drifted, controls varied, or opposite engine orders disagreed.

| Metric | Dense WebGL / WebGPU | Dense verdict | Hub WebGL / WebGPU | Hub verdict |
| --- | ---: | --- | ---: | --- |
| Steady frame p95 (ms) | 425.6 / 218.0 | Not assessed | 474.4 / 325.3 | Not assessed |
| First click (ms) | 1,210.6 / 305.1 | Not assessed | 1,193.0 / 472.9 | Not assessed |
| Click p95 (ms) | 1,497.9 / 465.6 | Not assessed | 1,193.0 / 498.5 | Not assessed |
| Cold startup (ms) | 559.0 / 441.3 | Not assessed | 570.8 / 438.8 | Within margin |
| Point update (ms) | 132.9 / 109.2 | Not assessed | 123.2 / 123.3 | Not assessed |
| Topology update (ms) | 377.2 / 350.4 | Not assessed | 427.2 / 437.6 | Not assessed |
| Full replacement (ms) | 659.1 / 640.6 | Not assessed | 684.1 / 716.7 | Not assessed |
| Resize (ms) | 60.4 / 65.5 | Not assessed | 50.8 / 61.6 | Not assessed |
| Peak tracked memory (MiB) | 418.6 / 265.2 | Within margin | 418.6 / 265.2 | Within margin |

The means describe the measured runs. For example, dense topology replacement averaged 350.4 ms on WebGPU and 377.2 ms on WebGL, but the paired WebGL runs drifted beyond the control limit. The complete build hashes, independent controls, both engine orders, individual observations and per-metric reasons are in `captures/packaged-force-timing-2026-11-26T10-50-24-553Z/`.

### Which ticks the autonomous trial measured

Both independent controls and both paired WebGL trials took their 48 steady intervals from ticks 9–57 on each topology. WebGPU took them from ticks 8–56. No steady frame was coalesced. By the last click the WebGL callbacks had reached ticks 118–122, compared with ticks 98–99 on WebGPU. At teardown after the edits, WebGL had submitted 119–123 ticks and WebGPU 98–99. The old trial recorded the callback tick and final submission count. It did not record the tick when the browser delivered the click or the edit sequence began.

Different layouts explain only part of the measurement problem. At exactly ticks 9–57 the dense WebGL controls measured frame p95 of 317.6 and 316.3 ms. The paired WebGL trials then measured 317.6 ms in the first order and 533.6 ms in the reverse order. On the hub, independent WebGL click p95 varied by 801.9 ms against a 16.7 ms cap. The hub's full replacements differed by 90.1 ms against 66.0 ms allowed. Successful picks and a healthy device confirmed the workload ran correctly in all cases.

### A matched tick and an empty input queue

Using the same archived distributions, the host completed ticks 8–56 consecutively, held every click at ticks 58, 60, …, 80, and paused at tick 80 for editing. All 144 click IDs, 999,990 ordered link endpoints, fixed points and the absent slot passed. Each graph released all tracked GPU bytes. The M3 ran on AC power. The raw capture includes both standalone files, their SHA-256 hashes, the host load averages, edit phases, callback times and every frame interval in `captures/packaged-force-timing-2026-11-26T11-19-02-647Z/`. WebGPU used luma.gl 10.0.0-alpha.15.

| Metric | Dense WebGL / WebGPU | Dense verdict | Hub WebGL / WebGPU | Hub verdict |
| --- | ---: | --- | ---: | --- |
| Host-driven frame p95 (ms) | 334.8 / 192.5 | A/A spread exceeded cap | 399.4 / 275.3 | Paired WebGL drift |
| First click (ms) | 15.6 / 31.8 | Slower | 16.0 / 32.4 | Slower |
| Click p95 and slowest of 12 (ms) | 43.5 / 32.3 | Within margin | 53.8 / 34.1 | Paired WebGL drift |
| Point update (ms) | 166.8 / 91.6 | Paired WebGL drift | 157.8 / 92.5 | Paired WebGL drift |
| Topology update (ms) | 315.2 / 374.9 | Slower | 349.9 / 433.3 | Paired WebGL drift |
| Full replacement (ms) | 559.2 / 525.1 | Within margin | 625.0 / 567.0 | Paired WebGL drift |
| Resize (ms) | 66.6 / 58.3 | Within margin | 65.5 / 66.7 | Within margin |
| Peak sampled GPU allocation (MiB) | 418.6 / 265.2 | Within margin | 418.6 / 265.2 | Within margin |

**Dense topology replacement** exceeded the 16.4 ms allowance in both orders. Synchronous public submission was similar at 227–234 ms. From the manual draw to the GPU fence notification, WebGL waited 77.8 and 83.6 ms and WebGPU waited 131.7 and 148.9 ms. Each trial made one manual draw. The fence interval includes driver work and completion delivery. Distinguishing individual GPU passes requires a trace.

**The first click on pinned Point 0** cost about one extra display interval in WebGPU on both topologies. On dense, the public callback arrived in 6.8 and 7.8 ms on WebGL and 20.7 and 17.9 ms on WebGPU. Across all twelve dense clicks, WebGPU met the original allowance. Emptying the queue changed the control substantially. Dense WebGL's slowest clicks dropped from 941.9 / 947.5 ms in the autonomous controls to 40.4 / 40.7 ms here. In both experiments most of the slowest click elapsed before its public callback.

The host uses the public single-frame path. WebGL's autonomous loop additionally performs adaptive near-field occupancy reads when sample counts are unset. The host also delays its next step until visible click feedback. These differences limit the timing verdicts to this scheduling pattern. Dense WebGL frame controls still differed by 13.8 ms against the 12.5 ms limit. Hub WebGL controls agreed at 333.3 / 334.5 ms, but its last paired WebGL trial reached 467.0 ms at the same ticks. The captures establish this run-order variation. They do not identify its physical cause. [Timing protocol](#/production-forces?section=doc-scale-method)

### Packed release and the cost of an idle repaint

The public tarball bundles luma.gl 10.0.0-alpha.14. Its standalone file (`f6e6a88b`) matched the installed and workspace copies byte for byte. Fresh WebGL (`74a216a7`) and this tarball completed another 12-process block with the same arrays, input ticks, controls and engine orders. On the hub, the first click and topology update exceeded the calibrated allowances in both orders. A lower average WebGPU time still left several comparisons unassessed when the paired WebGL timing drifted.

| Metric | Dense WebGL / WebGPU | Dense verdict | Hub WebGL / WebGPU | Hub verdict |
| --- | ---: | --- | ---: | --- |
| Host-driven frame p95 (ms) | 358.5 / 199.8 | Paired WebGL drift | 400.5 / 283.7 | Paired WebGL drift |
| First click (ms) | 14.8 / 23.2 | Orders disagreed | 13.6 / 40.0 | Slower |
| Click p95 and slowest of 12 (ms) | 43.4 / 33.0 | Within margin | 58.5 / 41.3 | Paired WebGL drift |
| Point update (ms) | 183.1 / 91.7 | Paired WebGL drift | 174.7 / 99.8 | Paired WebGL drift |
| Topology update (ms) | 341.0 / 366.6 | Paired WebGL drift | 358.5 / 431.9 | Slower |
| Full replacement (ms) | 632.4 / 517.7 | Paired WebGL drift | 633.5 / 573.9 | Paired WebGL drift |
| Resize (ms) | 75.1 / 50.1 | Paired WebGL drift | 66.0 / 66.7 | A/A spread exceeded cap |
| Peak sampled GPU allocation (MiB) | 418.6 / 265.2 | Within margin | 418.6 / 265.2 | Within margin |

The block and runtime versions are in `captures/packaged-force-timing-2026-11-26T11-29-19-306Z/`. Separate traces replayed the hub through the same 80 ticks. Updating link 1 on the paused WebGPU graph issued three full draws. The public `render()` painted immediately, its automatic callback painted again, and the host requested a manual draw. The two last canvas submissions finished about 29 ms apart. The parked cursor also triggered a new hover query after the link change. The first trusted click trace recorded an extra hover query from movement at the click coordinates followed by the fresh click query. See the WebGL trace in `captures/packaged-force-timing-2026-11-26T11-34-58-232Z/` and the WebGPU trace in `captures/packaged-force-timing-2026-11-26T11-35-33-388Z/`.

After the idle scheduling change, the packed standalone (`51929a23`) issued two full canvas draws for the same hub edit. The immediate public render, host-requested draw and one hover read all remained. The 12 click IDs, four public edits, pins, moving points and ordered endpoints passed. The isolated check counts draws while other correctness tests were running. Its raw trace is in `captures/packaged-force-timing-2026-11-26T11-39-49-622Z/`.

With the duplicate stationary hover check applied as well, the release tarball (`2865cb0f`) received a trusted mousemove, mousedown and click at identical coordinates on tick 58. Only the click issued a pick. It still read Point 0 from the GPU and displayed feedback in 16.0 ms in this trace. The preceding traces issued two picks and displayed feedback in 30.1 and 30.5 ms. The hub edit again used two canvas draws and refreshed hover after its topology changed. The isolated counts and DOM events are in `captures/packaged-force-timing-2026-11-26T11-42-55-124Z/`.
