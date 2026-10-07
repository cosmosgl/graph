<!-- suggested path: history/2026/2026-10-07-host-picking.md -->

# Host picking: cosmos.gl draws picking colors for a host's pick pass

**Commits:** `feat(points, links): a picking mode for a host's pick pass — drawToRenderPass draws index colors` (`ed15163`), `feat(deck-layers): deck picking, auto-highlight and drag through cosmos's picking mode` (`65a5c9e`)

## Why

With [cosmos rendering](2026-10-07-deck-layers-cosmos-rendering.md), `CosmosGraphLayer` lost
deck's picking: deck picks by re-rendering every `pickable` layer into an offscreen buffer
where each layer's shader writes its object's index as a color, and cosmos's draw programs
wrote colors. Hover, click, `autoHighlight` and drag-to-pin — all of which the 3.5.0 layer
had — were gone.

cosmos already renders an index pass of its own for hover (`renderMode > 0` writes the raw
index into a float target). deck's convention is only a different encoding of the same
idea, so the engine gained a sibling mode rather than the layer a second renderer.

## What changed

- **A picking mode in both draw programs** (`renderMode 3`). A covered fragment writes
  `index + 1` as three bytes — decode `r + g·256 + b·65536 − 1`, 0 is nothing — and an alpha
  the host supplies. The edge is hard: a point counts where its shape covers at least half
  the fragment (or an image does) and its color is not fully transparent; a link where the
  stroke does. Dash gaps count as covered, as in cosmos's own hover pass. The index comes
  from the vertex stage: points pass their linear index as a flat varying, links already had
  `linkIndex`.
- **A picking model per module.** `Points.drawPicking` and `Lines.drawPicking` run the same
  shaders over the same attribute buffers and textures through a dedicated `Model` with
  `BASE_PIPELINE_PARAMETERS` (blend off, no depth), so the visible models' pipelines are
  never toggled. The buffers are bound anew on each pick, because the data passes recreate
  them. The uniforms and bindings both draws share moved into `getDrawUniforms` /
  `getDrawTextureBindings` (`getDrawBindings`) so there is one source for them.
- **`drawToRenderPass(renderPass, { picking: { alpha, linkIndexOffset } })`** draws the
  picking pass instead of the graph: links first, offset by `linkIndexOffset`, then points,
  so where they overlap the point is picked, as in the visible draw.
- **The deck layer** draws it in deck's pick pass. deck tells its layers apart by the alpha
  byte, set through a constant-alpha blend whose constant arrives in the draw's
  `parameters.blendColor`; the layer hands that alpha to cosmos, which writes it directly
  (blend off). Links are offset by the point count, so one layer carries both index spaces
  and `getPickingInfo` splits them again into `elementType` and an index within the kind,
  with `object` for array data.
- **`autoHighlight`** maps onto cosmos's own emphasis: the hovered point gets the focus ring,
  the hovered link the focused-link width, through `setConfigPartial({ focusedPointIndex,
  focusedLinkIndex })`. deck's `highlightColor` tints through its picking shader module, which
  cosmos's shaders do not include; `config.focusedPointRingColor` is the knob.
- **Drag-to-pin is back**, and works on a map now: the pointer maps to space by inverting
  the view the layer derives for the viewport the pointer is in — the same derivation
  `draw` hands cosmos — so it holds under a map as well as an orthographic view; the 3.5.0
  layer unprojected through deck and so only worked under an orthographic view. It does
  not go through the view cosmos holds (`screenToSpacePosition`): that is whichever
  viewport drew the graph last, and in *Mini graphs* the main view's graph is drawn by its
  thumbnail too, so a drag there landed the point where the thumbnail's view put it.
- The stories have their hover, highlight and drag again.

## Alternatives considered

- **Two deck sublayers** (points, links) to keep the index spaces apart, as the old composite
  did. The offset does the same in one primitive layer, with no sublayers to explain.
- **cosmos's models declaring deck's picking blend** (`blendAlphaSrcFactor: 'constant'`) so
  deck's constant stamps the alpha. That bakes deck's convention into the engine; an explicit
  `alpha` is host-neutral and the layer reads deck's constant itself.
- **Toggling the visible models' parameters** per pick instead of a second model: luma
  rebuilds the pipeline on each toggle, twice per pick while the pointer moves.
- **cosmos's own hover picking** driven by a pointer API, bypassing deck's. deck's `pickObject`,
  `onHover`, `onClick` and `autoHighlight` would then not know the graph; this way they do.

## Notes

- **Tests.** The engine suite draws the picking pass into an RGBA8 target and reads it back:
  `[1,0,0,a]`, `[2,0,0,a]` at the two points, `[3,0,0,a]` on the link with an offset of 2,
  zeros just outside the point's hard edge. The deck suite picks points and links through
  `deck.pickObject`, follows a moved point, checks `autoHighlight`'s focus keys, and drags.
- **Soft edges are not picked.** deck's own layers pick wherever a fragment is not
  discarded, which includes their anti-aliasing fringe; cosmos picks the half-coverage
  outline. The difference is under a pixel.
- **Links are padded** by the 5 px cosmos adds for its own hover pass (`renderMode > 0` in
  the vertex shader), so thin links are hoverable; deck's `pickingRadius` adds to that.
- **Images** pick on their bounds, not their alpha.
