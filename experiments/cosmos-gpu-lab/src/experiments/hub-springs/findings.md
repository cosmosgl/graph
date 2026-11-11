For current controls and stronger acceptance evidence, see [Trajectories and thresholds](#/hub-springs/docs/acceptance).
The first study below used threshold 64, no plain-direction fallback and per-frame readback. Its timings
are historical observations; do not pool them with the newer GPU-batched measurements. The follow-up also
checks spring stages against their original tighter CPU budget.

This experiment follows the [controlled stage profile](#/gpu-stage-profile/docs/method), where the star's
first directional spring pass dominated GPU time. It adds an **unpinned hub control**, a **degree sweep** and
order-preserving shader candidates. Existing CPU references and tolerances stay unchanged.

## Degree without changing total graph size

The graph is a connected broom: point 0 has the selected number of spokes, then one chain visits the remaining
points. Every case has the same point count, `pointCount − 1` links, input coordinates, random samples, sizes
and unit weights. Only topology and the explicitly selected hub pin flag change. All points are present.
Pinned and unpinned controls share coordinates; pinning does not skip force evaluation.

The default sweep tests hub degrees 64, 256, 1,024, 4,096 and 8,191 at 8,192 points, with both hub states.
Alpha is 1, tick/seed is 0, the camera is fixed and positions are restored before every frame. This is a fixed
workload comparison, not an independently evolving layout or a production-default simulation.

## Preserve the recurrence

Cosmos does not simply sum independent edge vectors. Each neighbor uses the velocity accumulated from its
predecessors:

```text
delta[k] = neighbor[k] − (point + velocity[k])
velocity[k + 1] = velocity[k] + correction(delta[k], edge[k])
```

A parallel reduction would change that nonlinear recurrence as well as floating-point addition order.
The candidates instead retain the same CSR edge order and scalar correction sequence:

- **Uniform hoist:** compute the unchanged rounded `spring × alpha` once outside the neighbor loop.
- **Cooperative prefetch + hoist:** low-degree points retain the ordinary gather. Each point with at least
  64 directional neighbors gets one 64-invocation workgroup. Invocations fetch consecutive edge/neighbor
  records and compute rest distances into shared arrays. Invocation 0 then applies those 64 corrections
  sequentially before the next tile. It never combines or reorders corrections.

The shader derives its rest-distance and recurrence code from the current corrected spring source. It uses
`workgroupUniformLoad` for a uniform edge range and barriers before reading/reusing cached records, following
[WGSL collective-operation rules](https://www.w3.org/TR/WGSL/#workgroupUniformLoad-builtin).
No subgroups or floating-point atomics are required. Hub lists are refreshed with topology/count updates.

## Comparison and validation

Both variants borrow **one luma device**, use separate resources and the same canvas. The baseline remains
the strict gravity/rounded-step candidate. Only spring scheduling changes. A normal frame still uses one
simulation compute pass plus drawing. Diagnostic profiles retain the separate 15-pass timing method.

Before timing, every force stage must match the baseline's position/force bits and pass the original CPU
comparison. Independent whole-tick CPU positions are checked too. Every timed frame is then restored from
the same input and must match the normal replay exactly, while passing that unchanged CPU gate.

Two warmup and eight measured rounds balance the four baseline/candidate × normal/profile combinations.
Each trial repeats four individually restored, checked frames. GPU durations are summed and divided by four;
ranges describe eight accepted trial means. Allocation, position uploads, CPU reference work and readback stay
outside GPU queries. Each normal frame is timed through the ordinary path; diagnostic pass gains alone do
not establish an improvement. Timer quantization and scheduling still limit small-difference claims.

**Export JSON** retains inputs once per pin state, stage/anchor gates, every raw frame and trial order, timings,
partial results and cleanup accounting. Measurement exports stay outside Git.

## Reproduce

Open [Ordered hub springs](#/hub-springs). Start with 8,192 points, degree 8,191 and **Unpinned**.
Compare the selected candidate, then use **Run degree + pin sweep**. The sweep includes both pin states.
Repeat with **Uniform scale hoist only** to isolate that change. Keep the tab visible; **Stop** preserves
completed work and **Export JSON** saves local results.

```sh
LAB_NATIVE_GPU=1 pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/combined-layout/hub-spring.test.ts
```

## Findings

On Apple M3, standalone Chrome 156 and luma `10.0.0-alpha.4`, cooperative prefetch improves the **normal frame**
for the full 8,192-point star. The unpinned result repeats; pinning is not what creates the benefit.
The smaller-degree results are mixed. Keep this as an explicit experimental candidate, not the default backend.

### Degree and pin control

These are per-frame GPU medians from one complete sweep. Negative change means less GPU time.
“Paired wins” counts the eight measured rounds where the candidate beat the baseline in that same round.
The ordinary frame includes GPU bounds, gravity, hierarchical repulsion, both spring directions, integration
and minimal point/link drawing. It is the lab's current engine slice, not the full Cosmos renderer.

| Hub degree | Hub state | Baseline ms | Prefetch ms | Change | Paired wins |
| --- | --- | ---: | ---: | ---: | ---: |
| 64 | Unpinned | 11.436 | 9.077 | −20.6% | 3/8 |
| 64 | Pinned | 10.338 | 10.174 | −1.6% | 2/8 |
| 256 | Unpinned | 13.681 | 11.887 | −13.1% | 5/8 |
| 256 | Pinned | 12.968 | 15.327 | +18.2% | 1/8 |
| 1,024 | Unpinned | 15.753 | 15.614 | −0.9% | 4/8 |
| 1,024 | Pinned | 12.501 | 13.402 | +7.2% | 2/8 |
| 4,096 | Unpinned | 15.966 | 14.680 | −8.1% | 8/8 |
| 4,096 | Pinned | 10.985 | 8.659 | −21.2% | 6/8 |
| 8,191 | Unpinned | 12.632 | 11.010 | −12.8% | 8/8 |
| 8,191 | Pinned | 12.927 | 10.985 | −15.0% | 8/8 |

The low-degree medians alone are misleading: degree 64 unpinned has a lower candidate median, yet loses five
of eight paired rounds. Its baseline trial means span 7.520–17.367 ms and its candidate 7.111–15.958 ms.
Degree 256 pinned regresses in seven paired rounds. The results do not establish a universal gain or a good
dispatch threshold of 64. More warmup, repeated low-degree controls and a threshold sweep remain necessary.

Full-star sweep ranges are narrower: unpinned baseline 12.075–13.255 ms versus candidate 10.879–11.354 ms;
pinned baseline 12.747–13.648 ms versus candidate 10.863–11.420 ms. The diagnostic first spring force also
falls from 8.053 to 6.070 ms unpinned and 7.987 to 6.201 ms pinned. Those split-pass measurements support the
attribution, but they are not a decomposition of the normal frame.

### Repeats and the simpler control

Each row below is a fresh study with the same full-star settings and balanced trial policy.

| Candidate | Hub | Run | Baseline ms | Candidate ms | Change | Paired wins |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Prefetch + hoist | Unpinned | Initial | 16.294 | 13.345 | −18.1% | 8/8 |
| Prefetch + hoist | Unpinned | Repeat after sweep | 16.654 | 13.836 | −16.9% | 7/8 |
| Prefetch + hoist | Pinned | Repeat after sweep | 15.401 | 14.074 | −8.6% | 7/8 |
| Hoist only | Unpinned | Control | 12.567 | 13.541 | +7.8% | 2/8 |

Absolute times drift between runs; comparisons are paired within each study. The hoist control's diagnostic
first spring cost is essentially unchanged, 7.897 versus 7.954 ms. Hoisting alone shows no gain here. The
observed full-star benefit belongs to the cooperative scheduling candidate; this does not identify cache or
compiler behavior as the proven hardware cause.

Across the 14 captured cases, **2,240 restored frame checks, 56 stage gates and 28 normal anchors pass**.
All force/position replay comparisons match exact bits; CPU absolute `2e−5` and relative `3e−5` tolerances are
unchanged. Every GPU timer is valid and every retired case reports zero tracked buffer bytes remaining.
The candidate adds two hub-ID buffers: 65,536 bytes at 8,192 points. It also adds a kernel and, where a direction
has hubs, one dispatch within the existing compute pass. Construction/topology-update costs are outside the
frame measurement and have not been benchmarked in this study.

Native regression coverage also checks multiple hubs, a high-degree reverse direction, a partial tile, varied
weights, an absent neighbor, a pinned hub, topology replacement and logical-count changes. The measured sweep
still uses unit weights, fixed rest lengths, alpha 1 and initial frozen inputs. It does not establish trajectory
acceptance over changing alpha, random production rest lengths, many hubs, other GPUs or larger stars.

### What this changes for the migration

An ordered Cosmos hub gather can become faster through luma compute without replacing its nonlinear spring
law or weakening validation. Keep the baseline and both controls available. Before enabling the candidate in
resident layouts, validate evolving trajectories and choose a degree threshold from repeated normal-frame
measurements. Grid aggregation remains a separate large cost for chain/community graphs.
