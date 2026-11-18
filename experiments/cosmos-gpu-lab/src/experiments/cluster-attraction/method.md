# How cluster attraction works

Two points in one group at x = −8 and x = 8 have their center at 0.
Cluster attraction moves each toward 0. If the left point is pinned, it stays at
−8 but still helps define the center. A group can instead have a supplied target,
including negative coordinates. Cosmos does not discover these groups: the caller
supplies the membership.

This is a new force investigation. Earlier “clusters” and “communities” fixtures
described starting positions or graph topology; they did not validate `simulationCluster`.

## Production rule

For each group, add the positions of its present assigned points and divide by
their count. Pinned points contribute; absent and unassigned points do not.
Per-point strength changes attraction, **not** the center's weight.

For an assigned point, the production shader computes the distance and direction
to the supplied target or group center. Its force is
`alpha × distance × simulationCluster × pointStrength × direction`.
A point already at its target gets zero force. The ordinary integrator applies
friction and preserves pinned and absent positions.

The isolated study fixes alpha at 0.6, `simulationCluster` at its production
default 0.1, friction at its default 0.85, and the existing 4,096-unit step guard.
It does not apply cooling, springs or repulsion. Cluster attraction alone
collapses each free group; overlap in this preview is expected.

## Three implementations

```flow
Same positions and supplied membership
Production WebGL additive blending | WebGPU grouped reduction | Independent CPU sums
Group sum of x, y and present count
Supplied target or group center
Attraction, then integration
Compare sums, force, position and independent trajectory
```

WebGL imports the production cluster vertex/fragment shaders and position
integrator without editing them. The lab adapter supplies their textures and
uniforms through luma Models. Each reduction clears its group texture before
additive blending; the following passes explicitly disable blending.

WebGPU builds a stable list of original point IDs for each group when membership
changes. Each workgroup reduces at most 256 members. A second dispatch combines
the partials for each group, including zero for empty groups. Both reduction
levels retain the high and low sum components already used by the corrected
center-force experiment. The force and integration reuse the existing corrected
arithmetic. No floating-point atomics or compute blending are required.

The CPU uses ordinary independent loops over point membership, double-precision
sums rounded to the aggregate's float32 format, and the existing stepwise float32
force model. It does not read the candidate's grouped index. This is a
compatibility reference, not an emulator of every permitted GPU operation.

## Checks and limits

Use the existing combined-force gate: `2e-5 + 3e-5 × abs(reference)` per XY
component; group counts and flags are exact. Only explicitly absent NaN positions
may remain NaN. Unused absent-point forces are excluded, as in existing force
checks; absence itself and the preserved position remain checked.

Check each sampled GPU tick against CPU evaluation from that GPU's own input.
Also compare the independently evolved coordinates against the CPU trajectory.
An unordered WebGL blend can disagree with the CPU sum: report that as a failed
control, without changing its shader or weakening the gate.

The adapter supports 1–8,192 points and 1–64 group slots in this investigation.
It supports fixed-size membership, strength and target updates; a point/group
count change recreates the comparison. The production Graph setters, animated
updates, centroid cache/readback API, labels, combined force ordering, collision,
picking, framing and complete-frame performance are outside this step.

Force-only GPU time includes reduction and attraction, with readbacks and input
uploads outside the interval. It does not establish the 95%-within-33-ms frame
target or the 50-ms picking target. Those targets remain unchanged.
