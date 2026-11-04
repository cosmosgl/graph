# Link defaults resolve at read time

**Date:** 2026-11-04
**PR:** [#286](https://github.com/cosmosgl/graph/pull/286)

**Why:** Link color and width ingest replaced `NaN` sentinels inside caller-owned arrays.
Later default changes therefore stopped reaching those links, and rendering mutated
application data.

**Decision:** Preserve matching input arrays verbatim and resolve `NaN` from
`linkDefaultColor` / `linkDefaultWidth` in the shader and public getters, matching point
colors and sizes. Missing or mismatched arrays become engine-owned all-`NaN` arrays.

**Tradeoff:** Read-time resolution adds a small shader selection but avoids a second
20-byte-per-link resolved copy and O(n) scans and uploads whenever a default changes. This
is a bug fix, so no migration entry is required.
