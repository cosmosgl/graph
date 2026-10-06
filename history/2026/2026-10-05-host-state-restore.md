<!-- suggested path: history/2026/2026-10-05-host-state-restore.md -->

# Handing the host its GL state back

**Commits:** <!-- TODO -->

## Why

The city labels in the *Graph on a map* story (a deck.gl `TextLayer` drawn after the graph)
came out jagged, with dark halos around every glyph. The shared-device contract from
[host embedding](2026-08-18-host-embedding.md) was one-sided. Before its passes,
`resetExternalDeviceState()` turned off blending and depth testing (and reset scissor,
stencil, cull and color mask) so the host's state could not corrupt the position textures.
It never turned them back on.

deck.gl enables blending and depth testing once, when it creates the device, and its own
layers declare neither. So after the first simulation step every deck layer drew unblended:
a glyph's anti-aliased edge wrote its partial coverage straight into the canvas alpha, and
the page background showed through. On cosmos.gl the deck context read
`BLEND: false, DEPTH_TEST: false` between frames. Opaque fills look the same without
blending; text shows the problem at once.

## What changed

- **Reset becomes save, reset, restore.** `GraphSimulation.withExternalDeviceState(work)`
  (`@internal`) replaces `resetExternalDeviceState()`. It runs `work` through luma's
  `withParametersWebGL`: luma's state tracker (on for every WebGL device) records what the
  reset and the passes change, and restores it when `work` returns. It also restores on a
  throw outside an open render pass; a throw inside one pops luma's pass frame instead, which
  is no worse than before.
- **Every entry point that used the reset now wraps its passes.** These are the simulation
  step, `setPointPositionsByIndices`, a cluster read (the blocking sum and the non-blocking
  copy it may issue), a tracker's gather (the `Points.withHostState` hook, replacing
  `resetHostState`), and `Graph`'s rendered frame. Cosmos-owned devices skip it, as before.
- **The step body moved, unchanged, into a private `runStepPasses`.** `runSimulationStep` is
  now the wrapper around it. The `member-ordering` lint rule puts private methods after the
  public ones, so most of the `simulation.ts` diff is that move (`git diff --color-moved`
  shows it). A public `runStepPasses` left in place would have made the diff smaller. It was
  turned down because it would be a second way to run a step without the wrap.
- **Data passes declare `blend: false`.** Restoring the host's blending exposed three passes
  that never declared their own blend state: sampled points (`getSampledPoints`,
  `getSampledPointPositionsMap`) and the rect and polygon queries. They write data whose
  alpha is a y position, so the host's blending scaled the result: sampled indices came back
  as `[1000, 6000, 9000]`, and a query dropped a point at y = 0. They only worked before
  because the leaked reset left blending off. They are reached through `Graph` between
  frames, not through deck-layers.

## Alternatives considered

- **Fix only the deck layer.** This would leave `Graph`, app-driven `step()`, tracker reads
  and cluster reads leaking.
- **Declare blend state on every simulation Model.** Pipeline parameters cannot turn off the
  scissor test, so the ambient reset would still be needed.
- **Raw `pushState()` / `popState()` pairs.** This is the smallest diff, but every exit has to
  be paired by hand, and a throwing `onSimulationTick` would skip the restore.

## Notes

- Callbacks that run inside a wrapped pass (`onSimulationTick`, hover events) see cosmos's
  state, and any GL state they set through luma is undone with it.
- **Tests.** The engine suite checks that the host's blend function and depth function
  survive a step, a sparse write, a tracker read and a cluster read. It also checks that a
  `Graph` frame on a shared device leaves them alone, with sampled points and a rect query
  correct under host blending. The deck suite checks that deck's `BLEND` and `DEPTH_TEST`
  survive the layer stepping on deck's timeline. Each test fails without its half of the
  fix.
- **Not addressed.** A few `Graph` paths on a shared device still run with neither reset nor
  restore: synchronous picks on click and drag start, `getSampledLinks*`, and the empty-data
  clear in `render()`.
