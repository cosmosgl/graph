---
source: Recorded findings
recorded: 2026-11-18
device: Apple M3, visible Chrome, luma.gl 10.0.0-alpha.15
scope: Frozen uniform and clustered inputs at 8,192 and 16,384 points
---

# Workgroup repulsion evidence

Both tested workgroup variants matched the stored-contribution force and
position bits and passed the unchanged CPU checks on all four frozen inputs.
Each workgroup used 512 bytes of scratch space for contributions.

## What was compared

The stored, chunked, direct and two workgroup methods used the same points,
hierarchy, sampled neighbors and precise shell. The chunked control also passed
all four cases. Direct accumulation passed three, but failed one force and two
position components for the 16,384-point clustered input.

The recorded timing ranges overlapped in several cases, so they do not establish
a universal speed ranking. These are bounded same-input checks on one device;
they do not establish complete graph performance or portability to other GPUs.
