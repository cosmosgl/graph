# Hover picking: screen-space ID buffers

![The picking buffers: a half-resolution point map read through a 9×9 cursor window, and a full-resolution link index buffer read at the single cursor pixel](picking-scheme.svg)

Hover detection keeps GPU-rendered "what's under each pixel" maps instead of
scanning elements per mouse move:

- **Points** — every point is rasterized as a circular sprite carrying
  `[point index, x, y]` per pixel (empty = `−1`) into a half-resolution buffer
  (capped at 1536px, `rgba32float`). A hover reads only the 9×9 pixel window
  under the cursor and picks the valid candidate nearest to it — constant cost
  at any point count, with a small forgiveness radius as a bonus.
- **Links** — the full-resolution link index buffer (`[link index, 0, 0,
  validity]`, rendered by the same link draw shader switched to index mode) is
  sampled at the single cursor pixel. Full resolution because a 1px link would
  fall between half-res texels; alpha gates pickability; dash gaps stay
  pickable (the dash mask applies only to the visible pass); the hovered link
  is drawn wider in this buffer (hover hysteresis). A picked point always wins
  over the link result.

Both buffers re-render only when marked stale (movement, zoom, resize, data or
config updates, hover change) and are read back asynchronously (PBO + fence),
so the hover path never stalls the GPU pipeline. Clicks, drag starts and
long-presses still read synchronously — they need the answer inside the event.

The full engineering record — why the old scheme was O(elements) with a
pipeline stall, the change-gating rules, the async lifecycle invariants — is
[`history/2026/2026-07-09-picking.md`](../../history/2026/2026-07-09-picking.md).
The code lives in `src/modules/Points/picking-*.ts`, the `fill-picking-buffer`
shaders, and the picking paths of `src/modules/Lines/index.ts`; the tunables
(window size, resolution scale, buffer cap) are
`src/modules/Points/picking-constants.ts`.

Regenerate the diagram with `node gen-picking-scheme.mjs` from this folder —
keep it in sync with `picking-constants.ts` when the numbers change.
