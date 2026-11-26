# Replay moving selection and labels on Apple M3

For the 3.6.1 geometry and transition replay, build both distributions and run the following from the repository root. The `selection-361-m3-6436b55a-01` captures record the packaged adapter reports and selected IDs. The six-point fixture covers both selectable modes, shape and image updates, and paths beyond 32,768 vertices.

```sh
LAB_ARTIFACT_RUN=area-modes-01 pnpm --filter @cosmos.gl/gpu-lab test:gpu \
  src/experiments/production-graph-api/area-selection.test.ts \
  src/experiments/production-graph-api/point-style-updates.test.ts \
  src/experiments/production-graph-api/sparse-transition.test.ts
```

For the sparse point replay, build both distributions as shown below, then run from the repository root with a fresh capture name. The test records the adapters, full-frame differences, click IDs, surviving coordinates and ordered rectangle and lasso IDs for each region.

```sh
LAB_ARTIFACT_RUN=sparse-area-01 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/sparse-transition.test.ts
```

The M3 replay is in `captures/sparse-area-m3-release`. Its `provenance.json` records the clean revision, bundle hashes and adapters. In `package-sparse-transition-{1,2}x.json`, each package’s `selections` lists the old position, midpoint, destination and whole-graph control. Inspect restoration at 521/522 and 749/750/751 ms to reproduce the destination crossings.

The same test also runs the interrupted-removal case. It sends the restoration edit on the frozen 500 ms removal frame and gives the return its own 1,000 ms transition. In `captures/interrupted-removal-m3-release/package-sparse-interruption-{1,2}x.json`, compare `remove` at 500 ms with `restore` at 0 ms. Each package’s `sites.old` and `sites.destination` record the actual click and pixel color. The `selections` field records the ordered ID lists. The run’s `provenance.json` identifies the adapter, clean revision and both bundle hashes.

For the second removal, inspect `captures/repeated-removal-m3-release/package-sparse-remove-again-{1,2}x.json`. The `restore` sample at 500 ms and the `remove-again` sample at 0 ms share the same clock time. Compare the three sites’ click IDs and RGB values, the rectangle and lasso results, the point’s painted bounds and the sampled link color. The run’s `provenance.json` identifies the clean revision and both package bundles.

For the return to the original center, compare `remove-again` at 500 ms with `restore-original` at 0 ms in `captures/restore-original-m3-release/package-sparse-restore-original-{1,2}x.json`. The three click sites are x = 48 (`old`), 64 (`midpoint`) and 80 (`destination`, the first restoration target). The `restoredOriginal` fields compare the initial and settled canvases within each package. The run’s `provenance.json` identifies the clean revision and package bundles.

For removal during the return trip, open `captures/remove-on-return-m3-release/package-sparse-remove-on-return-{1,2}x.json`. Compare `restore-original` at 500 ms with `remove-on-return` at 0 ms and 500 ms. In this case, `sites.returnMidpoint` and the matching selection region are at x = 56. The other local probes stay at x = 48, 64 and 80. The run’s `provenance.json` identifies the clean revision, device reports and bundle hashes.

For restoration to x = 80 during the third fade, use `captures/restore-to-80-m3-release/package-sparse-restore-to-80-{1,2}x.json`. Compare `remove-on-return` at 500 ms with `restore-to-80` at 0 ms. Each later time is measured from that edit. Read `sites` for the four click IDs and canvas colors and `selections` for the ordered rectangle and lasso IDs. At each ratio, compare `settledAt80Sha256` with the same field in `package-sparse-transition-{1,2}x.json` to check the full canvas against an uninterrupted restoration. The run’s `provenance.json` identifies the revision, adapters and bundle hashes.

For the fourth removal, open `captures/remove-at-68-m3-release/package-sparse-remove-at-68-{1,2}x.json`. Compare `restore-to-80` at 500 ms with `remove-at-68` at 0 ms on the same clock tick. `sites.removalCenter` and the corresponding selection region add x = 68 to the four existing probes. Compare the before-edit canvas with the canvas 500 ms into removal using `repeatedMidpoint`, and inspect the click and area IDs on both frames. The run’s `provenance.json` identifies the bundles and native adapters.

## Curved link crossing a point

Build both standalone packages and run the native browser check from the repository root with a fresh capture name.

```sh
LAB_ARTIFACT_RUN=curved-crossing-01 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/curved-crossing.test.ts
```

The two endpoints of link 0 move together while point 2 stays at (128, 80) CSS px. Compare the same pixel and click twice at each checkpoint, once in the complete graph and once with only the endpoints and their link. The second graph reveals what the point covers. The M3 run in `captures/curved-crossing-m3-release/` includes the per-frame pixel comparisons, click callbacks, bundle hashes and reported adapters.

## Curved link behind a point image

Run the same native motion with one image on point 2. Keep the previous opaque-point replay as a control.

```sh
LAB_ARTIFACT_RUN=image-crossing-01 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/image-crossing.test.ts src/experiments/production-graph-api/curved-crossing.test.ts
```

At 0, 500 and 1,000 ms, compare the three opacity bands and (174, 80), 46 CSS px right of center. Run each click with point 2 present and omitted. Check the full RGBA canvases, painted strip bounds and whether any differing pixel also differs in the link-only control. The M3 results and bundle identities are in `captures/fixed-image-crossing-m3-release/`. The earlier capped renderer is recorded in `captures/curved-link-image-m3-release/`.

Two isolated controls distinguish image color from the click footprint. With the Lab running on port 5180, run these commands from the repository root. The first changes only the invisible shape’s color under a half-alpha image. The second sweeps a fully opaque image from 48 to 128 CSS px and clicks five offsets at each size.

```sh
node experiments/cosmos-gpu-lab/captures/curved-link-image-m3-release/image-alpha-control.mjs
node experiments/cosmos-gpu-lab/captures/curved-link-image-m3-release/size-control.mjs
```

## Dashed link crossing a solid link

Build both standalone distributions from the repository root and use a fresh capture name. The packaged Graphs run the same paused scene and receive pointer events at the same five CSS coordinates.

```sh
LAB_ARTIFACT_RUN=styled-link-crossing-01 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/styled-link-crossing.test.ts
```

Translate the horizontal red link 16 CSS px along its path to put the center of a dash or gap at (128, 80). Keep the vertical green link and camera fixed. Test both link-array orders and each link alone. The single-link controls establish the paint and callback for each style, and reversing the order reveals which link takes precedence. Compare complete RGBA frames as well as the crossing, two sites on the dashed path, the exposed solid stroke and empty space.

The M3 run in `captures/styled-link-crossing-m3-release/` contains the two `package-styled-link-crossing-{1,2}x.json` reports and the revision, bundle hashes and adapter details in `provenance.json`.

## Overlapping translucent arrowheads

Open `#/production-graph-api?section=try-translucent-arrow-crossing`. Build both standalone Graph distributions, then run the same check on each adapter with a fresh capture name.

```sh
LAB_ARTIFACT_RUN=arrow-heads-native pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/translucent-arrow-crossing.test.ts
LAB_ARTIFACT_RUN=arrow-heads-software LAB_SWIFTSHADER=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/translucent-arrow-crossing.test.ts
```

The five frames per ratio include both record orders, each link alone and the same crossing with arrowheads disabled. The control frames supply each link’s coverage across the entire image, allowing a one-channel-level rounding allowance when reconstructing the composite. The five probe colors and click IDs must match their expected values exactly. The runs in `captures/translucent-arrows-{m3,swiftshader}-20261126/` contain the measured pixels, clicks, adapter reports and source provenance.

## Point-only style updates

Rebuild both standalone distributions. Use a fresh artifact run name for each comparison.

```sh
LAB_ARTIFACT_RUN=point-styles-native-02 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/point-style-updates.test.ts
```

Each ratio has eight frames from each real package. Compare the RGBA hashes, center and midpoint colors, painted spans, size getter and five click IDs against the previous candidate. Each frame also records the ordered IDs from both area APIs at four offsets. The engine browser suite separately checks buffer writes and identity, interpolation sources, highlights and live collision sizes.

The 4,096-point / 8,192-link capture in `captures/point-styles-uploads-zF7J7b` includes the two standalone WebGPU bundles and a Chrome runner that records public luma buffer allocations, CPU writes and GPU copies. The full update is a positive control. Run `node uploads.cjs before` and `node uploads.cjs after` from that directory to replay the four isolated style edits.

The M3 control uses the WebGPU package from `6b56fb87`. The per-frame hashes and probes are in `captures/point-style-visual-control-6b56fb87` and `captures/point-style-visual-m3-corrected/before-after.json`. Chrome 158.0.8127.37 reported ANGLE Metal on Apple M3 for WebGL and Apple Metal 3 with fallback disabled for WebGPU. Run `production-points/tile-origin.test.ts` alongside the replay to isolate the 32-pixel circle independently of the edit.

For displayed-size pointer picking, `captures/displayed-pick-control-b615b882` contains the target-size baseline. The same test records clicks 20 and 22 CSS pixels below the center immediately before and after interruption. `captures/displayed-pick-fixed-m3/before-after.json` compares the five click results, painted diameters, colors and full-frame hashes at all eight checkpoints per ratio. In the clean replay, `captures/displayed-pick-release/provenance.json` identifies the two standalone bundles and the tested revision.

For area selection, the M3 replay is in `captures/transition-area-m3-release`. Its `provenance.json` identifies the tested revision and bundle hashes. In `package-point-style-updates-{1,2}x.json`, each sample’s `selections` contains the top edge’s signed offset in CSS pixels from point 0’s center and the two ID lists. The test checks each list against the fixture geometry at that checkpoint.

## Independent headless trackers

Build both standalone packages and run the tracker regression from the repository root. Use a new capture name each time.

```sh
LAB_ARTIFACT_RUN=headless-trackers-02 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/headless-trackers.test.ts
```

The two JSON files contain the adapter, full positions, tracker maps, cached maps, ordered arrays and results of reads in flight. The M3 baseline in `captures/headless-trackers-baseline-a28c25d3` completed the WebGL replay. Its WebGPU package had no `trackPoints()` method. In `captures/headless-trackers-m3-release` the ANGLE Metal Apple M3 control and the Apple Metal 3 WebGPU adapter (fallback disabled) agreed through simulation teardown. The neighboring `provenance.json` identifies the code, both bundles, browser and luma versions for the run.

## Stationary hover

Build both standalone Graph distributions from the repository root. Run the native Chrome comparison with a fresh capture name each time.

```sh
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
LAB_ARTIFACT_RUN=stationary-hover-01 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/production-graph-api/stationary-hover.test.ts src/experiments/production-graph-api/sparse-transition.test.ts
```

The two hover JSON files record the runtime adapter, callback history, mouse-move count, ring coverage around the cursor and RGBA differences for each paired frame. The WebGL control and candidate each run in their own frame at 192 × 128 CSS pixels. The replay sends one pointer move, then uses position setters and the public zoom method. The candidate's input suite separately delays a real GPU pick and drives one gravity step.

The original M3 run is in `captures/stationary-hover-baseline-28481d58`. The verified build is in `captures/stationary-hover-release-kwpH3R`. The neighboring `stationary-hover-kwpH3R/provenance.json` identifies both standalone builds and the source archive (SHA-256 `4b306871085e5d94049629dc8be43f68644787e6dd5e10bb75f629f8c53997e9`).

## Moving YouTube selection and labels

Run from the repository root with native Chrome available. To prepare the fixture once, place the original SNAP archive at `experiments/cosmos-gpu-lab/captures/fixtures/com-youtube.ungraph.txt.gz` and run the first command below. The driver checks the prepared fixture's known digest and verifies that the frozen site contains it and both locally built standalone distributions. [YouTube fixture and source archive](../million-graph/production-envelope.md#workloads)

```sh
node experiments/cosmos-gpu-lab/scripts/prepare-youtube-fixture.mjs
pnpm run build
pnpm --filter @cosmos.gl/graph-webgpu build
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs
```

Keep the browser visible and run each session alone. At each size the driver opens fresh WebGL and WebGPU sessions to check correctness, then four more sessions to time the same four drags in WebGL/WebGPU and WebGPU/WebGL order. An individual run can be selected with a point count, `--engine webgl|webgpu` and `--mode correctness|timing`. Timing still runs both blocks. The driver exits with a failure if any required stage fails, after writing the available measurements for the other stages and sessions.

To investigate an unavailable million-point WebGL read, run the following diagnostic separately.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --mode drained
```

The diagnostic blocks the release handler on a full position read before issuing the usual two async queries. The simulation cannot advance between those calls. It stores the duration of the synchronous read and compares the returned IDs and tracked coordinates with that snapshot. Keep this run out of the interactive timing sample.

Use `--mode blocking` in place of `--mode drained` to check the same moving WebGL graph with `findPointsInRect`, `getTrackedPointPositionsMap` and `getPointPositionsArray` in a single release handler. This independently checks the spatial answers when the async APIs return null. It stalls the browser and runs separately from the timing blocks.

For each run inspect `result.json` under the printed capture directory. It contains the release endpoints, camera, simulation ticks, adapter, fixture and package digests, result-list digests, per-stage durations and any missing results. The adjacent static site, source archive and screenshots preserve the tested caller. The selection digest covers the full ordered list of graph indices. A failed read has a null result and its dependent UI stage has a null duration.

### Long lasso at four fixed ticks

Use the same prepared YouTube fixture and built Graph packages as the rectangle
comparison. This command runs WebGPU in its own visible Chrome session on M3.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 65536 --engine webgpu --mode correctness --lasso --release-ticks 10,26,40,54
```

Repeat with `--engine webgl` and with `1000000` points. If the WebGL async
query times out, retain that capture and repeat its command with `--mode blocking`
to check the synchronous selection and tracker.

Each drag traces 256 distinct CSS pixels. The driver holds the requested
simulation tick while Chrome delivers the full path, then resumes motion after
submitting the release reads. The capture must contain the requested path in
order, every selected ID in ascending order, zero missing or extra IDs, and
exact coordinates for all 1,000 tracked labels. The independent CPU check uses
the complete release positions from the engine under test. These runs establish
correctness at a known layout. Use the separate timing runs for feedback latency.

The November 26 M3 runs used Chrome 158.0.8127.37, WebGL bundle `7379115a…`,
WebGPU bundle `281eb928…`, and YouTube fixture `1b4f834c…`. Each local capture
retains the built site, exact bundle and input hashes, delivered paths and the
selection and label digests for each release.

| Points | Engine | Capture directory under `captures/` | SHA-256 of `result.json` |
| ---: | --- | --- | --- |
| 65,536 | WebGL | `public-graph-youtube-BIo6bu` | `db6ab89ba7d290f195240f7b4d97c18d1c5f6f30c844db90a6a762ffd9859ae9` |
| 65,536 | WebGPU | `public-graph-youtube-Mihx2E` | `38251cabf1ef3f7175260c525009efb604e1ece8ea9c822045adaa481a190307` |
| 1,000,000 | WebGL | `public-graph-youtube-pESchY` | `7570233fcc51dc3c9f8e3018e120f458a3499e8eb947c02ae8d632ea3542abf0` |
| 1,000,000 | WebGPU | `public-graph-youtube-XAaOYA` | `1d282b0d7174e309d980f534f160bdc76747a203dc88d50d26a153509e4c94f8` |

## Trace the WebGPU queue

Run the profile separately from the correctness and timing sessions.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --mode profile
```

The profile replays the same four drags using the real WebGPU package. It places public luma fences after the simulation submission and after the draw submission of the same tick. At pointer release it marks the queue immediately before issuing the two async queries and records the age of the submitted frame. It places two more fences around the highlight setter. The queries and UI updates proceed without waiting for these markers. Each interval ends when JavaScript observes a completion. Both markers can be delivered together even when their GPU submissions took different amounts of time. Use the isolated draws below to separate stage costs.

After the fourth drag the profile pauses simulation, stops the autonomous loop and waits for the queue to drain. It then times three manual simulation ticks, each followed by a separately timed draw of all points and links at those positions. Finally it disables link rendering, waits for that configuration update to finish and times three point-only draws at the last positions. Each operation starts with the previous one complete. These are submission-to-observed-completion times. Record release and final tick counts when comparing sessions because the moving layouts can reach different positions and link lengths.

To compare releases at the same simulation steps, move the pointer to the recorded endpoint, hold it there with the graph running and release at the named tick. The driver checks the actual tick in the release handler and records any missed target as a failed drag. These ticks came from the million-point profile of the original scheduler. Run the first command to measure queue depth at those steps and the second to compare both queries to full release snapshots.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --engine webgpu --mode profile --release-ticks 10,26,40,54
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --engine webgpu --mode correctness --release-ticks 10,26,40,54
```

To compare highlights at identical positions, add `--draw-tick 72` to the fixed-tick **profile** command. After the drags, this mode clears highlights, stops the autonomous loop, drains the GPU and steps the simulation to tick 72. It saves a full-position digest, then times applying the fourth drag's IDs, removing one ID, restoring it and clearing the selection. Each operation starts with an empty queue and records both the setter's return and GPU completion. The driver reapplies the same IDs, times three separately fenced draws with zero simulation steps, and captures the 1,922 × 1,082 graph canvas. Compare `frozenDraw.highlights`, `frozenDraw.positionsSha256` and `frozenDraw.image.rgbaSha256` across builds. Older frozen-draw captures recorded the draw costs and canvas without the intervening highlight measurements.

For a before/after timing comparison, run the following command on both builds. It runs two independent four-drag WebGPU sessions per size with natural release ticks and no diagnostic fences or full position copies.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs --engine webgpu --mode timing
```

## M3 run record

### Compare the same drags across package builds

The `--webgpu-bundle` option runs the current replay harness against an archived standalone package. The working tree can keep the candidate built. The driver's asset digest check verifies the exact distributions in each frozen site. These commands reproduce the early-layout profile and the uninstrumented fixed-tick timing of the package from before the highlight change.

```sh
replay=experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs
captures=experiments/cosmos-gpu-lab/captures
original="$captures/public-graph-youtube-YqmYe1/site/assets/index.min-DD4YIS9x.js"
node "$replay" 1000000 --engine webgpu --mode profile --release-ticks 4,8,12,16 --draw-tick 72 --webgpu-bundle "$original"
node "$replay" 1000000 --engine webgpu --mode timing --release-ticks 10,26,40,54 --webgpu-bundle "$original"
```

For the incremental-highlight control, use `$captures/public-graph-youtube-29mbD2/site/assets/index.min-DdfZte_V.js`. Omit `--webgpu-bundle` to use the locally built candidate. Run the fixed-tick correctness command at both 65,536 and one million points on each build. Compare the corresponding `result.json` files with `node experiments/cosmos-gpu-lab/scripts/compare-public-graph-youtube.mjs BEFORE/result.json AFTER/result.json`. The comparator checks the input and camera, release ticks, ordered ID digests and the exact returned Float32 XY pairs in ascending tracked-ID order. Two fixed-tick profiles with `--draw-tick` can be compared with the same command for position, selection and canvas digests.

In the early profile, read `frameAgeAtReleaseMs` to locate the release within the submitted frame. Read `queueAheadAtReleaseMs` to see how long earlier submissions took to be acknowledged after release. Subtract it from `timings.readbackReadyMs` to measure the remaining time until both queries returned. This difference includes query execution, transfer and JavaScript scheduling. Read `stepDoneAfterReleaseMs` and `drawDoneAfterReleaseMs` to check whether their callbacks could be observed separately.

### Initial package comparison

Chrome 158.0.8127.37 ran each visible session on Apple M3 under Node 24.6.0. The WebGL renderer reported ANGLE Metal on Apple M3. The WebGPU adapter reported Apple Metal 3 and `fallback: false`. The WebGL package SHA-256 was `71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d` and the WebGPU package SHA-256 was `44933b5ca508aa04395fc69b45ca088ab0aba4e90e2849def09a458bac66f435`.

| Sessions | Directory under the Lab's `captures/` | Source archive SHA-256 |
| --- | --- | --- |
| Matched correctness and timing | `public-graph-youtube-1mMhjr` | `85daee32da815b46b07fbf6eddb23466ebde8077a890244fc6fa9e8ae7458269` |
| Million-point WebGL after synchronous snapshot | `public-graph-youtube-2ZFLy1` | `25c981db83335dc3d57e79cc7f3dc161877d8c82c06d536537d7496f7d5fc520` |
| Million-point WebGL with synchronous queries | `public-graph-youtube-20Ry96` | `b8409e72b47647e48dffa59ae86950678e39cd152d12233f07295dedcaaa9f7b` |

The earlier pilot at `public-graph-youtube-kxFaOY` began applying highlights as soon as selection returned. The initial matched timing results came from `public-graph-youtube-1mMhjr`, where both public readbacks settled before any UI work.

## M3 queue investigation, frame pacing alone

The fresh WebGPU timing baseline used the clean source at `56a3cd3bd480a5a1756ee266741806bf56c53c0a`. The WebGPU distribution's SHA-256 before the scheduling change was `44933b5ca508aa04395fc69b45ca088ab0aba4e90e2849def09a458bac66f435`. The rebuilt WebGPU distribution's SHA-256 was `38397ace699d1d9ad14ff35f3f4184c51db23085de4e77e8bc38bd9e879a76d2`. All sessions ran in the same Chrome version. Each frozen site contains the WebGL distribution recorded above.

| Sessions | Directory under `captures/` | Source archive SHA-256 |
| --- | --- | --- |
| Fresh WebGPU timing baseline at both sizes | `public-graph-youtube-00VPxf` | `221c0009b871dd6b84fe016069cb9c3d4062a4a8d923e63ea210721fe3261f2f` |
| Million-point profile, original scheduler | `public-graph-youtube-3UZAXi` | `3933f195107209b487315520a7fcc308f64b8146799ec86c3d4dcf85e9d4e790` |
| Million-point profile, paced scheduler | `public-graph-youtube-KcMrUG` | `f31de43b4f9d8112927a5d14360839473c07d4af9696c882d1e33398c73084b4` |
| Both packages, correctness and timing after the change | `public-graph-youtube-Svy0xw` | `171c0b4cbc5cf3b1a741ed5cc1895a342b9cd9c841162e09d7a58fa9df4ef867` |
| Million-point paced-scheduler profile at the original release ticks | `public-graph-youtube-4x0Sa2` | `e68614a6da04072b8be80162a19f3683eab8da073bde84d1ccd50da877b339c6` |
| Million-point paced-scheduler correctness at the original release ticks | `public-graph-youtube-NYjT54` | `2d3441aa39c94ec738b580eb2b640441559ee3afb339e0506c31f767f79bfca7` |
| Fresh WebGPU timing at both sizes after the change | `public-graph-youtube-yI0Xdh` | `283b0f45484f8fbb63466702e350902d3b5629040d82e3468f32650340c1ecc0` |

To reproduce the original-scheduler profile, build WebGPU from the clean baseline revision, verify its distribution hash, and run it with the Lab driver and profile code from the `3UZAXi` source archive. That archive already contains work in progress on the scheduler. Its captured static site embeds the original standalone distribution actually measured. For the paced comparison, rebuild from the corresponding source archive and check the distribution hash before running.

In the paced-build correctness sessions, every selected ID and each of the 1,000 tracked XY pairs matched the release snapshot on all four WebGPU drags at both sizes and on all four 65,536-point WebGL drags. Those three cases also produced a highlighted frame and redrew the labels on all eight timed releases each. The million-point WebGL control returned null for both reads on all four correctness drags and all eight timed drags. The browser driver retains those failures and leaves the highlight and label redraw durations null when it cannot apply an update.

For a cross-build check of the ordered IDs, compare `oracle.selectedIdsSha256` for the million-point WebGPU correctness sessions in `1mMhjr` and `NYjT54`. Both released at ticks 10, 26, 40 and 54. All four complete ID-list hashes matched across builds, and all 1,000 label coordinates matched their engine's full snapshot on every release. The natural-tick, WebGPU-only sessions `00VPxf` and `yI0Xdh` isolate the effect of frame pacing at both sizes.

## M3 queue investigation, frame pacing and solid blended links

Build the pacing-only WebGPU control from revision `306932ef6c1cd97dbb67c2f7119563ab6703e816` and verify the `38397ace…` distribution digest above. The `rMdjxi` archive contains the frozen-draw driver and the proposed shader edit. Its static site embeds the pacing-only control that actually ran. The optimized package can be rebuilt from revision `f054c096f24fc26bec0ae6d26a2a3a39d8374586` or the `gNTrc5` source archive. Its WebGPU distribution SHA-256 is `b1309cbce12c73ada5d6d21115c7614fe115ab2891efbb2bb62a1848f292c145`. All final sessions use that distribution and the WebGL distribution recorded above.

| Sessions | Directory under `captures/` | Source archive SHA-256 |
| --- | --- | --- |
| Tick 72 frozen draw with frame pacing only | `public-graph-youtube-rMdjxi` | `e99a4bf61ae47014fb0d4e50c036d2a5eb2fe041e799e3f1f5b235878462ca17` |
| Tick 72 frozen draw with frame pacing and solid blended links | `public-graph-youtube-gNTrc5` | `c9b3306f640672474e124bb11bed2cf39952960cdc1cc63d96ef5d7173e54e76` |
| Final build, both packages, correctness and timing at both sizes | `public-graph-youtube-N9hawp` | `3e50cb3e4563a39c8dae140c28f162b5dc318f35133d0f1132d3073d8e905b5b` |
| Final WebGPU build, natural-tick timing at both sizes | `public-graph-youtube-b13DT7` | `27b183673931c8f75586e589612ed027273261cffbea1992f0e30bc19054992b` |
| Final WebGPU build, million-point correctness at the original release ticks | `public-graph-youtube-TQXSaU` | `c2b934f37ffde0b6190fb0f21ad3b7fb2265faef10cdfbdd99a4607410f44fa8` |

Both tick 72 controls had the same hash for all 2,000,000 position coordinates and the same hash for every RGBA pixel of the canvas. Median complete draw time fell from 146.0 to 102.6 ms (29.7%). The earlier control `public-graph-youtube-0Ue4Cx` failed the screenshot height check at 1,084 pixels. The corrected full-canvas controls above supplied the pixel and timing comparison.

Compare `00VPxf` with `b13DT7` for elapsed time before and after both changes, using the same WebGPU-only schedule and eight releases per size. In the final matched-package replay, all four WebGPU releases at each size and all four 65,536-point WebGL releases matched their ordered-ID and 1,000-label oracles. Each of these three cases also completed all eight timed interactions. The million-point WebGL control again returned null for selection and labels on all 12 releases. At the four fixed release ticks, every ordered ID-list hash in `TQXSaU` equaled its pre-change hash in `1mMhjr`, with zero mismatches for the tracked coordinates against each release snapshot.

## M3 highlight update comparison

The control used the WebGPU package from revision `2049589715dc9ea9d6376ddcf31ad7726290b78c` (bundle SHA-256 `b1309cbce12c73ada5d6d21115c7614fe115ab2891efbb2bb62a1848f292c145`). Build the candidate from revision `6e55d54c65b1afc408e9620679d2b4f013007b96` and verify its WebGPU bundle SHA-256 `5192e217ff340aba11786de07c9fc28c9f25e71c2b6f25b2752f125ed9ff2be2`. Both used the same WebGL bundle (`71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d`). Chrome 158.0.8127.37 ran on Apple M3 and reported an Apple Metal 3 WebGPU adapter. The static site under each capture contains the actual packages tested. The baseline frozen profile used the expanded driver with the control package.

| Sessions | Directory under `captures/` | Source archive SHA-256 |
| --- | --- | --- |
| Both packages, timing before highlight changes | `public-graph-youtube-CMOdeh` | `48f5d2236b94a54cc436d52bef1f9d694efd65790de25b29029b86254f364d5d` |
| WebGPU-only timing before, both sizes | `public-graph-youtube-nsnevk` | `df5afc6f63bff51182eeee099efab21041a2b82d086757b801466ddb0b2a9284` |
| Frozen highlight edits, before | `public-graph-youtube-YqmYe1` | `dfa0895e2480239e27afa91fa7ede8328c5f13e079548d82f7687bfc6b89d2e1` |
| Frozen highlight edits, after | `public-graph-youtube-WBarDg` | `da6e09f1532f3f944712c0fade92971982fd1347b8374565e78498a8f21f118d` |
| Million-point WebGPU correctness after, fixed release ticks | `public-graph-youtube-NWVd7Y` | `cff68007cb8d086abdbae6e489a669ba0de4cc50d3e47e40ed96d3b665b30cfe` |
| Both packages, correctness and timing after, both sizes | `public-graph-youtube-coS13K` | `fcc209ab81a1ea5b3733e243d464dfce6661740a268588cf821251eb58de1c15` |
| WebGPU-only timing after, both sizes | `public-graph-youtube-Ss0TcG` | `b65ecfcd0d68a90b3c2fcc2001fb13b60ab1e4c2ea6a2b4b05db31526e41e78c` |
| Million-point WebGL with synchronous queries | `public-graph-youtube-r351FX` | `e826a49db9f084c4cbc642e92f77ce906f9966e20a69cafe7576c53ee128f19e` |

Compare the eight `mode: timing` releases per engine and size in `CMOdeh` and `coS13K`. On both builds the four-drag timing blocks ran WebGL/WebGPU, then WebGPU/WebGL. For a fresh replay, use the default driver on the candidate and `--mode timing` on the control. To repeat the WebGPU-only comparison (`nsnevk` and `Ss0TcG`), add `--engine webgpu` to both timing runs. The earlier 290.7 ms million-point WebGPU setter median comes from `N9hawp`.

The four ordered ID digests at 65,536 points matched between `N9hawp` and `coS13K` at ticks 6, 10, 14 and 18. At one million points compare `TQXSaU` with `NWVd7Y` at ticks 10, 26, 40 and 54. All four complete ID digests matched. All 1,000 tracked XY pairs matched each corresponding release snapshot. In the tick-72 captures, the 4,705 highlighted IDs had digest `bf492cb35fe0417747127a3f7d8167c4da603912dc8b34ae5a51b9e7338815dc`, the positions had digest `22e7a5a0f82c9f227613f452f7ce32adeb0437f609fc33d32b76348810bb5509` and the raw RGBA canvas had digest `91d6cf2b4105439e6c65603ab00ccbd19b6ba9dcb60d7452023ee54cdda12110` on both builds.

On million-point WebGL all 12 async releases in `coS13K` returned null for both APIs. In the separate `--mode blocking` run (`r351FX`), the four ordered selections contained 463,961, 5,533, 74,713 and 7,814 IDs. All 1,000 tracked XY pairs matched on every drag. For the time spent inside synchronous rectangle selection, read `timings.selectionSubmitMs`.

## M3 investigation of the readback increase

Chrome 158.0.8127.37 ran visible sessions on Apple M3. The native WebGPU adapter reported Apple Metal 3 with fallback disabled. The original highlight package had digest `b1309cbc…` and the incremental-highlight control had digest `5192e217…`. The full digests appear in the preceding run records. Each capture below preserves the browser site with its two actual packages. The capture name is the suffix of `captures/public-graph-youtube-<suffix>/`.

| Workload | Capture | Source archive SHA-256 |
| --- | --- | --- |
| Original package, early million-point queue markers and tick-72 canvas | `8obdle` | `fc88cc068476653a702fbf2a586e76bc07f6db0ba174fbc97afda1fe089071c0` |
| Incremental-highlight control, same queue markers and canvas | `29mbD2` | `4b790e4030818929731398533afe1873ef9d29890cfb6db536073d8199a5ed99` |
| Original package, later fixed-tick timing | `dHBMGw` | `fbd75bb5fa23883023d595758c5280e3a4e03a138fc3c86c4275942353120ed0` |
| Incremental-highlight control, same later timing | `EGq1CJ` | `0031c5050b3d9cc06e1a0bf5f34a8963c0dac49c2e0904c3852e8449a04f5aee` |
| Incremental-highlight control, isolated stage costs after the early drags | `LJAWSA` | `a52efe2c09e7dbe97c0fb1216ee84363bd1520cba91e81c5bdc217cac9ef86c1` |
| Incremental-highlight control, 65,536-point correctness | `A1Pzmc` | `b746c4fc49bd9158d06d36fb2159a75b9367fe199d1dbff9e4bea58a17967226` |
| Incremental-highlight control, million-point correctness | `N5WSPy` | `9f58b40c35d158ba533a7f4fc612b21f2d1fa076e31fae4936cd690a274d60e7` |

These control digests identify each release. Each cell shows the first 12 hex characters of the ordered selection digest followed by the tracked XY digest. The comparator checks all 64 characters of both. `e3b0c44298fc…` is the empty selection.

| Release tick | 65,536 points, IDs / XY | One million points, IDs / XY |
| ---: | --- | --- |
| 10 | `4a35a59aabf3` / `6a51e3f1200f` | `eb40afe17132` / `1ef3ae077ad8` |
| 26 | `8855b93d9347` / `d12909ad460e` | `20580a638b90` / `0671fe786823` |
| 40 | `6ce9344d375c` / `1fbb047a431b` | `5c17cc4d4b96` / `c1e17e8a8560` |
| 54 | `e3b0c44298fc` / `d2398a083816` | `bf492cb35fe0` / `9a8e18b3e51c` |

The optimized renderer can be rebuilt from revision `069e635a697344bc57c3446aec1f4e363045f2b3`. It used WebGPU distribution SHA-256 `7ce19fe60bf0afe8cb615c0659f7bfe406f81e0001fe186d15ea3835ee598bf9`. Each pair below used the same fixture, engine, camera and gestures. Only the last pair used natural release ticks. Each run records its source archive SHA-256 in `result.json` under `source.snapshotSha256`. The `buFmjy` source archive digest was `0b12e80248204f73fc9513265d962d63d168ecf842575f814b0f9d9b1a850251`.

| Workload | Control capture | Candidate capture |
| --- | --- | --- |
| early million-point fixed timing | `OZgbkn` | `5W6IEc` |
| later million-point fixed timing | `EGq1CJ` | `3c0eA2` |
| 65,536-point fixed timing | `1xIDqk` | `jZtI1z` |
| 65,536-point correctness | `A1Pzmc` | `jFVkYI` |
| million-point correctness | `N5WSPy` | `FQ5NFr` |
| tick-28 canvas | `Wid9jG` | `e51IVK` |
| tick-72 canvas | `29mbD2` | `buFmjy` |
| natural-tick WebGPU-only timing, both sizes | `2sfR3D` | `Kfr0a1` |

Use ticks 4, 8, 12 and 16 for the early timing and both frozen-canvas profiles. The later timing and both correctness pairs use 10, 26, 40 and 54. Compare the correctness and canvas pairs using the command above. The digest prefixes in the preceding table also identify the candidate releases and the original pre-highlight package. Compare original `V8l2bs` with `jFVkYI` at 65,536 points, and original `4sJAl4` with `FQ5NFr` at one million. Both comparisons verified all selection and tracked-coordinate digests. At frozen ticks 28 and 72, all 2,000,000 position coordinates, the last ordered selection, and all 1,922 × 1,082 RGBA pixels matched their controls.

Before combining the changes, the common-RGB-only package in `PJn6qK` (revision `4c7e2695fe732a5f1629a3182a7abe13dce716fa`) drew the tick-72 canvas in 98.6 ms and the opaque-point coverage package in `hLa0Tw` in 101.6 ms. Each is the median of three draws. Both matched the `29mbD2` canvas. The coverage-only distribution was built separately. The `hLa0Tw/depth-only.patch` file (SHA-256 `bdc344e2f860b7e7c166803f172c0aea42d4561750d26aa0d45b6e8909074c3d`) preserves its source change relative to the incremental-highlight control.

The final ordinary matrix `1vPUf1` (source archive SHA-256 `4ff14119f2ff0300b252f3b4df0e774dd55e756d418c878f0261666333c69f2f`) ran all four native drags on both packages and sizes. WebGPU passed both correctness oracles at both sizes. WebGL passed at 65,536 points and returned null for both million-point async queries on all four correctness and eight timing releases. The separate million-point WebGL `--mode blocking` run `a4sZAk` (source archive SHA-256 `0ca4cba7ef4c3130d424cd971340bfa192ec5a5106ba8be0ef3caf25d3d3639a`) returned 463,961, 5,533, 72,761 and 7,611 IDs and all 1,000 expected XY pairs on each release. Its blocking times are retained in the raw capture.
