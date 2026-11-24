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

## M3 run record

Chrome 158.0.8127.37 ran each visible session on Apple M3 under Node 24.6.0. The WebGL renderer reported ANGLE Metal on Apple M3. The WebGPU adapter reported Apple Metal 3 and `fallback: false`. The WebGL package SHA-256 was `71f4cc54f0cf4912afead56d0ea865e85cb45078b44b378ae8cdae1360ef1f8d` and the WebGPU package SHA-256 was `44933b5ca508aa04395fc69b45ca088ab0aba4e90e2849def09a458bac66f435`.

| Sessions | Directory under the Lab's `captures/` | Source archive SHA-256 |
| --- | --- | --- |
| Matched correctness and timing | `public-graph-youtube-1mMhjr` | `85daee32da815b46b07fbf6eddb23466ebde8077a890244fc6fa9e8ae7458269` |
| Million-point WebGL after synchronous snapshot | `public-graph-youtube-2ZFLy1` | `25c981db83335dc3d57e79cc7f3dc161877d8c82c06d536537d7496f7d5fc520` |
| Million-point WebGL with synchronous queries | `public-graph-youtube-20Ry96` | `b8409e72b47647e48dffa59ae86950678e39cd152d12233f07295dedcaaa9f7b` |

The earlier pilot at `public-graph-youtube-kxFaOY` began applying highlights as soon as selection returned. The matched timing table uses only `public-graph-youtube-1mMhjr`, where both public readbacks settled before any UI work.
