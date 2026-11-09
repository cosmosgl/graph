# Count, scan and scatter

Assume four cells contain points with these counts:

```text
cellCounts  = [3, 0, 4, 2]
```

An exclusive scan produces the first destination of each cell. A final sentinel stores the total:

```text
cellOffsets = [0, 3, 3, 7, 9]
```

The range for cell 2 is therefore `pointIndices[3..7)`. Empty cells are natural: cell 1 has the
zero-length range `[3..3)`.

```flow
Positions
Atomic count · Read positions → cellCounts
Hierarchical exclusive scan · cellCounts → cellOffsets
Prepare scatter inputs
Positions · Read the same positions again | Cursors · Copy cellOffsets into mutable cursors
Atomic scatter · Positions determine the cell; atomicAdd on its cursor allocates a destination
pointIndices · Grouped by cell; cellOffsets retains immutable cell ranges
```

## 1. Count

One invocation handles one point. It converts coordinates from `[-1, 1]` into integer cell
coordinates and atomically increments `cellCounts[cell]`. Atomics are required because many
invocations may target the same cell.

This is the main contention point. The Uniform distribution spreads writes across the grid; the
cluster and diagonal presets intentionally create hot cells.

## 2. Hierarchical exclusive scan

Each workgroup scans 256 values in workgroup memory. It writes:

- 256 exclusive offsets for its block;
- one block sum for the next level.

The same shader recursively scans the block sums until one block remains. A descending pass then
adds each scanned parent offset back into its child block:

```text
16,384 cells → 64 block sums → 1 total
```

The implementation uses a Hillis–Steele workgroup scan. It performs more additions than the most
work-efficient Blelloch scan, but its synchronization pattern is compact and easy to audit. The
hierarchical structure—not the exact local scan—is the important reusable contract.

## 3. Scatter

The immutable offsets are copied into a cursor buffer. One invocation again handles one point:

```wgsl
let destination = atomicAdd(&cursors[cell], 1u);
pointIndices[destination] = pointIndex;
```

The atomic result gives every point in a cell a unique destination. Ordering inside a cell is not
stable and must not be used as a semantic property. The range membership is deterministic even when
the exact order is not.

## 4. CSR sentinel

`cellOffsets` contains `cellCount + 1` values. The final value is always `pointCount`, allowing every
cell—including the last—to use the same half-open range formula.
