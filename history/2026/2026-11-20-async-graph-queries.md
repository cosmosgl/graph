# Asynchronous area selection and tracked positions

Rectangle and lasso clicks can wait for queued GPU work. Tracked labels can
meet that same wait on each refresh. These workflows need a common way to
await the GPU on either rendering backend.

The Graph now exposes `findPointsInRectAsync`, `findPointsInPolygonAsync` and
`getTrackedPointPositionsMapAsync`. Each request captures the geometry at the
call and waits for its own GPU copy. A request resolves to `null` when data
replacement, device loss or timeout invalidates the result. Asynchronous
tracked reads also detect changes to the tracked set.

The Actions, Lasso Selection and Point Labels stories exercise the methods.
The label caller coalesces updates while a copy is pending. The browser tests
check overlapping queries and replacement. A native M3 replay measures the
actual selection highlight and label drawing on the production WebGL Graph.

Change `55fbf726` adds the APIs and the replay.
