<!-- suggested path: history/2026/2026-09-17-init-readiness.md -->

# Init readiness: flag set before the modules existed

**Commits:** `fix(init): flag the graph ready only once its modules exist` (`bc5ca5c`)

## Why

`isReady` gates `ensureDevice`, the queue public methods wait in until the device
is up. It was set at the top of the device promise's continuation, which since
4afb901 awaits luma's first canvas measurement (up to 500 ms) before building
`Points` and `Lines`. In that window public setters ran instead of queueing, and
`setPointPositions` dereferenced an undefined `points`. Init reaches the window
on its own: `setZoomLevel(initialZoomLevel ?? 1)` with a zero duration dispatches
the d3 zoom events synchronously, so a consumer calling a setter from `onZoomEnd`
failed on every construction and the instance stayed dead after
`Device initialization failed:`.

## Notes

- `isReady = true` now follows every module construction and store setup, set
  immediately before the init `setZoomLevel`; calls made before it queue and run
  once `ready` resolves.
- The init `setZoomLevel` sits after the flag. Placed before it, `ensureDevice`
  would queue the call behind consumer `ready.then` handlers and reset the camera
  after their `fitView`.
