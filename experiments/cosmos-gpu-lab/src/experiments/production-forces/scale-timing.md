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
