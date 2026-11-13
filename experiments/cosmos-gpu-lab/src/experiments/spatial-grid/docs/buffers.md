# GPU buffer model

The timed build operates on these GPU-resident buffers:

| Buffer | Shape | Role |
| --- | --- | --- |
| `positions` | `N × vec2<f32>` | Immutable point coordinates |
| `cellCounts` | `C × atomic<u32>` | Histogram written by count |
| `cellOffsets` | `(C + 1) × u32` | Immutable CSR ranges after scan |
| `cursors` | `C × atomic<u32>` | Mutable copy of offsets during scatter |
| `pointIndices` | `N × u32` | Point indices grouped by cell |
| scan partials | shrinking `u32` arrays | Block sums and scanned parent offsets |

`N` is the point count and `C = gridSize²`.

## Why offsets and cursors are separate

Scatter increments its cursor for every point. If it incremented `cellOffsets` directly, it would
destroy the CSR range boundaries needed by neighbour traversal. A GPU copy creates the cursor buffer
without a CPU round trip:

```text
cellOffsets ── copyBufferToBuffer ──▶ cursors
     │                                  │
     └── remains immutable              └── atomically incremented
```

## Approximate memory

Ignoring small parameter and partial-scan buffers:

```text
positions    8N bytes
pointIndices 4N bytes
cell arrays  12C bytes plus 4-byte sentinel
```

One million points therefore need roughly 12 MB for the core position/index data. Grid resolution
mostly affects the comparatively small cell arrays; point count dominates memory.

## Buffer views in a future luma abstraction

The same physical storage is interpreted as atomic integers in count/scatter shaders and ordinary
integers in scan/copy stages. A higher-level luma graph should describe those views and usages
explicitly so it can validate hazards and schedule the copy between compute passes.

## luma ownership

The grid borrows luma `Device` and `Buffer` objects. Its own buffers and `Kernel` objects are destroyed
without destroying the borrowed positions or device. `encodeBuild` records into the caller's luma
command encoder. A clear kernel resets counts before counting; the pinned alpha has no encoder-level
buffer-clear API. The scan, cursor copy and scatter remain GPU-resident across repeated builds.
