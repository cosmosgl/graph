On Apple M3, WebGPU reduced the 95th-percentile interval between observed completed frames by 44% on each 8,192-slot graph. All 144 clicks during motion returned the expected point or background. Both run orders met the predeclared frame and click margins.

| Topology | Frame p95, WebGL / WebGPU | Frame change | Click p95, WebGL / WebGPU | Click change | First click, WebGL / WebGPU | Worst individual click, WebGL / WebGPU | Allowed slowdown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dense communities | 33.65 / 18.70 ms | −14.95 ms (−44.4%) | 20.70 / 17.30 ms | −3.40 ms (−16.4%) | 16.80 / 15.60 ms | 23.3 / 17.9 ms | 4.16 ms |
| Hub | 33.40 / 18.65 ms | −14.75 ms (−44.2%) | 18.60 / 17.15 ms | −1.45 ms (−7.8%) | 15.90 / 15.15 ms | 20.4 / 17.4 ms | 4.18 ms |

The frame p95, click p95 and first click average the two comparison trials per engine. The worst individual click is the largest across those two trials. At twelve clicks per trial, the nearest-rank p95 is the slowest click in that trial. All 8,064 free points moved in every session. Pins and absence stayed exact. Each topology used identical input-array hashes and settings across its six sessions.

### Frames and clicks in the live graph

Each fresh foreground Chrome session loaded one standalone package into a 961 × 541 CSS canvas at DPR 2. The benchmark used the same seeded inputs, camera, styles and forces as the Lab comparison and enabled the package’s own render loop. It sampled idle refresh before loading either engine. After each simulation tick, a microtask placed a public luma fence after the frame’s draw had submitted. An animation-frame observer recorded the latest GPU-finished frame available at each browser presentation opportunity. Earlier submissions that finished in the same opportunity were counted as coalesced. The measurement includes submission, GPU completion, browser scheduling and the presentation opportunity.

After eight warm-up frames, each trial recorded 48 frame intervals. WebGL missed 16 and 14 refresh opportunities in the dense comparison trials, and 16 and 13 in the hub trials. WebGPU missed zero across all four paired windows. The largest WebGPU interval was 18.7 ms. The application took full XY snapshots before motion and after pausing at the end of the click sequence. Frame and click timing both ran without those validation reads.

Each trial alternated twelve real mouse clicks between pinned Point 0 and clear background. The pointer dwelled for two completed frames before each click. The normal public callback updated a visible result. The timer started at the trusted click timestamp and ended at the next animation opportunity after that update, a proxy for presentation. The captures retain the callback and feedback timestamps separately. Every click resolved within two idle refresh intervals.

### Paired verdict

Two independent WebGL controls set the margin before each topology's first WebGPU trial. Idle refresh was about 16.7 ms. The allowance was the greater of the control spread and a quarter refresh. The user-impact caps were three quarters of a refresh for frame p95 and one refresh for click feedback. The controls stayed within their caps and both engine orderings passed. [Timing decision](#/viewer-comparison?section=doc-migration-benchmark)

| Topology and trial | Frame p95, WebGL / WebGPU | Click p95, WebGL / WebGPU |
| --- | ---: | ---: |
| Dense, WebGL then WebGPU | 33.9 / 18.7 ms | 18.1 / 17.9 ms |
| Dense, WebGPU then WebGL | 33.4 / 18.7 ms | 23.3 / 16.7 ms |
| Hub, WebGL then WebGPU | 33.5 / 18.7 ms | 20.4 / 16.9 ms |
| Hub, WebGPU then WebGL | 33.3 / 18.6 ms | 16.8 / 17.4 ms |

Run `pnpm --filter @cosmos.gl/gpu-lab benchmark:packaged-forces` with both packages built and no other GPU tests or builds active. Each run writes `source.json`, an exact source archive, two WebGL control captures and four paired captures per topology under the Lab’s `captures/` directory. The M3 run is `scale-forces-20261124/native-timing/`. Chrome 158.0.8127.37 reported ANGLE Metal Apple M3 for WebGL and Apple metal-3, fallback false, for WebGPU. The run record includes both standalone bundle hashes and the full timing samples.
