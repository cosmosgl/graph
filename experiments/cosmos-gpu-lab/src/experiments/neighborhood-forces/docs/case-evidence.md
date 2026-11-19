---
source: Recorded findings
recorded: Not recorded
device: Native Apple / Metal 3 adapter, Chrome 156
scope: Paired baseline and chunked traversal for dense, sparse and small fixed-radius inputs
---

# Local repulsion evidence

The baseline and chunked grid traversals passed all **72 initial** and **18
evolved** checks. Neighbor counts matched exactly at each checked target and
all outputs were finite. The candidate's largest force error used 20.7% of its
allowed tolerance.

| Input | Grid | Change in complete GPU tick time with chunking |
| --- | --- | ---: |
| Dense | 16 × 16 | 23.3% faster |
| Dense | 32 × 32 | 8.4% faster |
| 4,096-point case | 16 × 16 and 32 × 32 | About 14–15% slower |

The comparison used the same fixed-radius force and unchanged validation
tolerances. At 65,536 points each validation checked 1,148 targets; at 4,096
points it checked 1,118. These selected workloads and one adapter do not
establish a universal traversal policy or complete graph-frame performance.
