# Replay moving selection and labels on Apple M3

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

## Trace the WebGPU queue

Run the profile separately from the correctness and timing sessions.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --mode profile
```

The profile replays the same four drags using the real WebGPU package. It puts a public luma fence after every autonomous frame and counts submitted frames whose completion callbacks have yet to arrive. At pointer release it places another fence immediately before issuing the two async queries. It places two more around the highlight setter. The queries and UI updates continue without waiting for these extra fences. Each elapsed interval ends when JavaScript observes the completion signal, so callback scheduling contributes to it. Use the ordinary timing runs for user-facing latency and the separate correctness runs for ordered IDs and tracked XY coordinates.

After the fourth drag the profile pauses simulation, stops the autonomous loop and waits for the queue to drain. It then times three manual simulation ticks, each followed by a separately timed draw of all points and links at those positions. Finally it disables link rendering, waits for that configuration update to finish and times three point-only draws at the last positions. Each operation starts with the previous one complete. These are submission-to-observed-completion times. Record release and final tick counts when comparing sessions because the moving layouts can reach different positions and link lengths.

To compare releases at the same simulation steps, move the pointer to the recorded endpoint, hold it there with the graph running and release at the named tick. The driver checks the actual tick in the release handler and records any missed target as a failed drag. These ticks came from the million-point profile of the original scheduler. Run the first command to measure queue depth at those steps and the second to compare both queries to full release snapshots.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --engine webgpu --mode profile --release-ticks 10,26,40,54
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs 1000000 --engine webgpu --mode correctness --release-ticks 10,26,40,54
```

To compare the cost and pixels of a particular drawing change, add `--draw-tick 72` to the fixed-tick **profile** command. After the drags, this mode stops the autonomous loop, drains the GPU, and steps the simulation to precisely tick 72. It hashes the full position array, times three separately fenced draws with zero simulation steps, and captures the graph canvas at its 1,922 × 1,082 backing resolution. Compare `frozenDraw.positionsSha256`, `frozenDraw.image.rgbaSha256` and the median of the three `completedMs` values. The ordinary profile command measures the isolated simulation and draw stages described above.

For a before/after timing comparison, run the following command on both builds. It runs two independent four-drag WebGPU sessions per size with natural release ticks and no diagnostic fences or full position copies.

```sh
node experiments/cosmos-gpu-lab/scripts/public-graph-youtube.mjs --engine webgpu --mode timing
```

## M3 run record

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
