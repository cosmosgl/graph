<!-- suggested path: history/2026/2026-09-24-links-by-point.md -->

# Links grouped by point in typed arrays

**Commits:** `perf(data): group links by point in typed arrays — rebuilt only when the links change` (`36b92d5`)

## Why

`GraphData` stored each point's links as JS arrays of `[neighbor, link]` pairs,
one pair per link per direction, and rebuilt them in every `update()`. `render()`
calls `update()` unconditionally, so the rebuild ran on every render — after a
point color change or a position update too, not only after `setLinks`. At 1M
points and 5M links one build took over a second and left ~590 MB of small arrays
behind (Chrome, ~40 B per pair plus ~90 B per point list), and `ForceLink.create`
then walked the pairs through a closure per link.

## What changed

- `linksBySource` / `linksByTarget` (type `LinksByPoint`, exported) hold the same
  grouping as three `Uint32Array`s: `offsets` (`pointsNumber + 1`), `neighbors` and
  `linkIndices`. A counting sort fills them in link order, which is the order the
  pair lists had and the layout `ForceLink`'s textures use, so its textures come out
  bit-identical.
- The grouping and the degrees are rebuilt only when `inputLinks` is assigned or the
  point count changes. `inputLinks` became an accessor so that assigning the same
  array again — links edited in place and passed back to `setLinks` — still counts.
- Degrees are the differences of adjacent offsets.
- `sourceIndexToTargetIndices` / `targetIndexToSourceIndices` are deprecated getters
  that build the pairs from the typed arrays on first read and cache them until the
  next rebuild. Readers keep working; only they pay for the pairs. They are no longer
  assignable.

## Notes

- With links set before any point positions, the deprecated getters now return
  `undefined`; before, they returned a one-entry list (`new Array(undefined)`) for a
  graph with no points. Degrees and every query were already `undefined` / empty there.
- An `update()` that leaves the links alone still reallocates the per-point and
  per-link style arrays (`updatePointColor`, `updateArrows`, …): 12 ms at 1M links,
  28 ms at 5M. Not addressed here.

## Numbers

1M points, synthetic links, production build, headless Chrome 153 on an Apple M3.
Five rounds, `main` and this branch alternating, fresh page per round; memory is
retained heap plus array buffers after forced GC.

| | 1M links, before | 1M links, after | 5M links, before | 5M links, after |
|---|---|---|---|---|
| first `GraphData.update()` | 246–375 ms | 50–70 ms | 1052–1381 ms | 182–215 ms |
| retained by it | 252 MB | 96 MB | 753 MB | 272 MB |
| `update()` again, links unchanged | 246–273 ms | 12–13 ms | 1037–1647 ms | 26–29 ms |
| `ForceLink.create`, per direction | 305–430 ms | 100–108 ms | 803–1700 ms | 442–501 ms |
| `Graph.render()` of the data load | 1137–1453 ms | 521–566 ms | 3606–4393 ms | 1464–1581 ms |
