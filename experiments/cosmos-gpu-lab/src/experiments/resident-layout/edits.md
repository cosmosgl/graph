In both previews, advancing a step applies the current forces and cools the layout. An edit leaves
that step count and cooling value in place, so the next step starts from the current state.

- **Move and pin first point** updates one position in both alternating position buffers. Each
  record is 16 bytes, so the edit uploads 32 bytes per preview. The pinned point stays fixed.
- **Replace links** validates the topology, builds the new directional link lists on the CPU
  and uploads their buffers. Once both the springs and the renderer switch to the new lists,
  the old link buffers are released. The device, kernels and position buffers stay in use.

The CPU-bounds and GPU-bounds previews receive the same edits. The result after advancing compares
their layout data exactly. The two previews own separate devices. Changing the point count is
covered by [Adding and removing points](#/point-capacity?section=doc-method).
[WebGPU buffer writes](https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writebuffer) ·
[Buffer destruction](https://gpuweb.github.io/gpuweb/#dom-gpubuffer-destroy)

## Recorded check

On 11 November 2026, both previews matched bit for bit after each of four edits to an
8,192-point star on Apple M3 in standalone Chrome 156. Moving and pinning the first point
uploaded **32 bytes per preview**. Both previews kept their devices and position buffers
as the links changed.

| Link edit | Bytes allocated for the new link buffers |
| --- | ---: |
| Replace star links with community links | 712,672 |
| Remove all links | 98,360 |
| Restore star links | 425,952 |

Even with zero links, the bundle still holds sizes and offsets. These figures describe the
new bundle only. Peak memory was outside the measurement. Each edit had a single CPU submission
timing, too few samples to compare edit speed.

Across timing, bounds and edits, the recorded native suite passed 13 tests, including the
40-checkpoint bounds matrix and an independent CPU check of a whole step after link changes.
Shared devices, recovery and atomic edits across devices remain open. The same session’s
[recorded frame timings](#/resident-frame-timing?section=doc-recorded) cover simulation and drawing.
