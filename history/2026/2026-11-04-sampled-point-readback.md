# Non-blocking sampled point positions

**PR:** [#290](https://github.com/cosmosgl/graph/pull/290)

Refreshing visible labels during a pan can stall on a synchronous GPU read.
The sample is tied to the screen grid, so camera motion can change the selected
point IDs even when the world-space positions stay fixed.

Both sampled point getters accept `{ nonBlocking: true }` and share a fenced
copy. The opt-in returns an empty sample until the first copy completes and
then serves the latest completed snapshot while refreshing it as needed. The
synchronous default still reads the current view immediately.

The Point Labels story compares synchronous and non-blocking sampling at the
same animation-frame cadence and also includes a tracked-points mode.
