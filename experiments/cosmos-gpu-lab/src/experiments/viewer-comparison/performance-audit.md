Use Viewer Comparison for the migration speed decision. The other examples
measure a named part of the workload or replay an earlier experiment. Their
original results and acceptance checks remain attached to those experiments.
[Run the migration benchmark](#/viewer-comparison?section=doc-migration-benchmark)

## Viewer and workflow measurements

| Example | What the number measures | Use for migration |
| --- | --- | --- |
| [Viewer Comparison](#/viewer-comparison?section=doc-migration-benchmark) | The new benchmark observes each backend's native loop separately, with the same loaded graph, canvas and user workflows. | Use paired timings and the WebGL A/A margin. The original host-paced Karate timings and their pick-event mismatch are historical. |
| [Million-point moving graph](#/million-graph?section=doc-interactive-study) | Historical synchronized WebGPU animation, pick feedback and tracked allocation for a simpler point and link renderer. | Use the new dense, hub and YouTube runs for the matched comparison. Keep the old optimization measurements tied to that renderer. |
| [Integrated viewer](#/integrated-webgpu?section=doc-findings) | WebGPU browser intervals, feedback, pacing, and sometimes separate GPU stage durations for named graph shapes and configurations. | Keep the slow clicks and star result as evidence. Use the paired default-force runs for relative speed and retain the composed-force numbers as stress evidence. |
| [Karate Club pilot](#/pilot-viewer?section=doc-latency-evidence) | Time through the next animation opportunity after drawing the highlight. Includes the original 100.4 ms stall and smaller/different replays. | Keep the original 50 ms check with those captures. The new click metric starts at the same trusted event on both backends and shows a common page marker. |
| [Selection and labels](#/integrated-webgpu?section=doc-readback) | Area results and label presentation. The earlier million-point WebGL input was paused, and the resident WebGPU inputs were moving. | Use the same moving graph and the same `CosmosLabels` consumer for a relative timing verdict. |
| [Resident layout and updates](#/resident-layout?section=doc-timing-updates) | GPU work, CPU submission, and GPU completion on bounded WebGPU layouts, plus sparse position and link edits. | Use to explain costs within the candidate. Use the matched renderer and normal viewer loops for workflow latency. |
| [Point capacity](#/point-capacity?section=doc-findings) | Retained buffers, copied bytes and bounded resize/append checks. | Evidence about the allocation and update strategy. Compare memory during the same viewer workflow. |

## Force and rendering diagnostics

| Example | Timed work and scope |
| --- | --- |
| [Performance lab](#/performance-lab?section=doc-methodology) | Identical circle draw and center reduction microbenchmarks. Wall completion includes submission and the wait. Each measures one operation at fixed inputs. |
| [Global center of mass](#/center-mass?section=doc-once-findings) | GPU timestamps for the reduction plus the isolated linear center force. Dividing once versus per point has no clear timing difference. A separate frozen compute-and-draw run also stayed within run-to-run variation. |
| [Scalable reduction](#/scalable-reduction?section=doc-performance) | Hierarchical GPU reduction and optional readback. The ten-million-point result uses GPU-generated inputs, a capped preview and limited CPU verification. |
| [Spatial grid](#/spatial-grid?section=doc-performance) | Count, scan, and scatter. The live timing describes index construction. |
| [Neighborhood forces](#/neighborhood-forces?section=doc-performance) | GPU batch time per grid build, force, integration, draw, or a complete frozen tick. The batch amortizes submission and completion. |
| [Exact global repulsion](#/many-body?section=doc-timing) | Isolated all-pairs force and integration on controlled inputs. Direct and tiled kernels have their own recorded accuracy checks. |
| [Hierarchical repulsion](#/many-body-grid?section=doc-precision-cost) and [Workgroup repulsion](#/workgroup-repulsion?section=doc-force-speed) | Frozen hierarchy, force variants, precision and temporary allocation. The resident prototype also has complete WebGPU tick tests on declared synthetic graphs. |
| [Shared distant repulsion](#/million-graph?section=doc-cell-field) | About 9 ms less median time from submission through completion for the one-million-point tick, including the shared field and draw. The uniform case's p95 increased. These pairs use WebGPU for both solvers. |
| [Ordered cell aggregation](#/cell-aggregation?section=doc-findings) | GPU aggregation and instrumented stages, plus a bounded normal GPU frame. The instrumented breakdown uses different scheduling. |
| [Weighted links](#/weighted-links?section=doc-performance) and [Hub springs](#/hub-springs?section=doc-acceptance) | Ordered spring-stage and bounded prototype tick times. Degree distribution matters. Historical direct WebGL reset evidence and the bounded continuation replays cover different implementations. |
| [Collision](#/collision?section=doc-hashed-findings) | Hashing, slot and correction checks, and the added GPU tick cost of two passes at 8,192 points. Higher density and larger graphs have separate WebGPU observations. Production defaults leave collision off. |
| [Cluster attraction](#/cluster-attraction?section=doc-findings) and [Point attractors](#/point-attractors?section=doc-findings) | Frozen force work and bounded trajectories. Cluster cost depends on group shape and whether positions were supplied. Corrected-attractor cost includes its arithmetic. |
| [Pointer repulsion](#/mouse-repulsion?section=doc-findings) | Isolated force correctness, pointer mapping and held/released behavior. The composed stress test has a separate cost for the mouse stage. |
| [GPU stage profiler](#/gpu-stage-profile?section=doc-method) | Frozen inputs under normal and split-pass GPU timestamp scopes. Compare like scopes and budgets. |
| [Combined layout](#/combined-layout?section=doc-spring-cost) and [Matched layout](#/matched-layout?section=doc-findings) | Bounded force passes, frozen whole-tick timing and independent trajectory checks. Use the timing to locate force or arithmetic costs and the trajectories to assess layout quality. |
| [Circle drawing demo](#/point-rendering?section=doc-case-method) | Visual comparison of sprites and quads with supplied positions. The performance lab provides the controlled circle timing. |
| [Million-point draw cost](#/million-graph?section=doc-draw-cost) | Isolated point/link draw timestamps and GPU-fenced drawing or highlight time for a fixed camera and positions. The 24.5 to 13.7 ms result times reduced drawing on that frozen view. |
| [Compute-generated ribbons](#/ribbon-generation?section=doc-findings) | Frozen cache generation and ribbon draw versus vertex evaluation. The cache failed the recorded cost and image checks. |
| [Point shapes](#/point-shapes), [picks](#/point-picking), [images](#/point-images), [effects](#/point-rings-greyout), [straight links](#/straight-links), [curved links](#/curved-links) and [smoothstep coverage](#/smoothstep-coverage) | Fixed geometry, pixel, visibility and ID studies. Any isolated draw or ID costs describe those paths. Use the matching appearance workload before extrapolating to an integrated viewer. |

[Layout acceptance](#/layout-acceptance), [repulsion trajectories](#/repulsion-trajectories),
and [precision diagnostics](#/precision-diagnostics) primarily check motion or
arithmetic. They establish no independent viewer speed claim.
