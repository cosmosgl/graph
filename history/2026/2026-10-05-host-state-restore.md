<!-- suggested path: history/2026/2026-10-05-host-state-restore.md -->

# Handing the host its GL state back

**Commits:** PR #278: `fix(simulation): hand the host its GL state back after passes on a shared device` (`66180d8`), `fix(force, points): every overwrite pass declares its pipeline state itself — correct outside the wrapper too` (`f35661b`), `fix(simulation): the host-state wrapper pops back to its own depth — a throw inside a pass no longer strands the host's state` (`c4551e3`); review follow-up, same PR: `fix(simulation): the throw-path restore finds the tracker through gl — a host's own luma copy is unwound too` (`2ef53f2`), `fix(force, points, links): every model declares its full pipeline state — correct outside the wrapper, whatever the host's winding` (`867b23d`), `fix(simulation): pin the host's scissor and colour mask across the wrapper — and that the reset keeps them off cosmos's draws` (`2c4be82`)

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
  throw: luma keeps one stack of state frames per context, and a render pass pushes its own
  frame on top of the wrapper's, so a throw before the pass ends would leave both up and a
  single pop would restore the pass frame and strand the host's beneath it, with blending
  off for the rest of the session. The wrapper records the stack depth before it pushes and
  pops back to it on the way out. It finds the stack through the context (`gl.lumaState`),
  not by checking the device's class, so a device created by the host's own copy of luma is
  unwound too.
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
- **Every model declares its own pipeline state, through one constant.** The nine
  models that relied on the wrapper for it — the gravity, centre, mouse and link forces,
  the cluster force, and the position update, the interpolation, the tracker gather and
  the drag — now carry it like the query passes. `BASE_PIPELINE_PARAMETERS` in
  `core-module.ts` is blend off, no depth write, depth always, stencil always, no culling
  and counter-clockwise winding — every state a pipeline can declare that changes what
  cosmos draws. The fifteen passes that overwrite use it as is, so a grep for the name
  lists them. Every other model spreads it first and overrides its own blend, depth or
  culling: the additive sums and forces (centre of mass, collision, the many-body levels
  and near field), the near-field slot build with its depth test, the point draws, and the
  link curves with their back-face culling. A model is then correct on its own against the
  host's blend, depth, stencil, cull and winding, inside the wrapper or reached from an
  entry point that is not. The winding matters for the links: they cull back faces, the
  wrapper never sets a winding, and a host that left clockwise winding would cull the
  faces the links keep. Depth bias, stencil operations and the extension-only states stay
  undeclared: luma cannot declare them off, or they cannot change these draws. Every pass
  still inherits the host's scissor and colour mask, which no pipeline parameter
  expresses: those stay with the wrapper, with the restore. No behaviour changes: blend
  and the depth test were already at these values on a cosmos-owned device and under the
  wrapper, stencil, culling and winding are the WebGL defaults there, and the depth mask,
  newly off on five passes, changes nothing while the test is off.

## Alternatives considered

- **Fix only the deck layer.** This would leave `Graph`, app-driven `step()`, tracker reads
  and cluster reads leaking.
- **Declare every ambient state on every simulation Model, and drop the reset.** Pipeline
  parameters cannot turn off the scissor test or set the colour mask, so the ambient reset
  would still be needed. Blend, depth, stencil, cull and winding are declared on every
  model since — see "What changed" above — and the reset stays for the two that cannot be.
- **Wrap the remaining `Graph` paths one by one.** Each new entry point would need its own
  wrap, and a missed one would leak again. Owning the state at the pass covers them all at
  once — see "Not addressed".
- **Raw `pushState()` / `popState()` pairs.** This is the smallest diff, but every exit has to
  be paired by hand, and a throwing `onSimulationTick` would skip the restore.

## Notes

- Callbacks that run inside a wrapped pass (`onSimulationTick`, hover events fired from a
  frame) see cosmos's state, and any GL state they set through luma is undone with it. A
  draw made on the device from such a callback is painted with blending off, and the
  restore puts the state back, not those pixels: request the draw and make it after the
  callback returns, as deck's own frame does. The same callbacks fired from a pointer event,
  and the click, context-menu and drag callbacks, run outside the wrapper.
- **Tests.** The engine suite checks that the host's blend function, depth function,
  scissor box and colour mask survive a step, a sparse write, a tracker read and a cluster
  read, and that a step still moves the points under the host's empty scissor box and
  closed colour mask. It also checks that a `Graph` frame on a shared device leaves them
  alone, with sampled points and a rect query correct under host blending. The deck suite
  checks that deck's `BLEND` and `DEPTH_TEST` survive the layer stepping on deck's
  timeline. Each test fails without its half of the fix, except the scissor and
  colour-mask survival checks, which pin behaviour that already held; the step check fails
  without either reset.
- **Not addressed.** The `Graph` paths outside its rendered frame still run outside the
  wrapper on a shared device: the rect and polygon queries, sampled points and links,
  synchronous picks on click and drag start, and the empty-data clear in `render()`. Since
  every model declares its pipeline state, what they can still inherit is the host's
  scissor and colour mask, which a clear respects too. The follow-up is to own the state
  at the pass instead of the entry point: a luma render pass already saves the state when
  it begins and restores it at `end()`, and takes a `scissorRect` and a `colorMask` that it
  applies before its clear and at every draw. A helper that opens every pass with the full
  scissor rect and an open mask leaves cosmos nothing to set outside a pass, so nothing to
  restore. That covers these paths, lets callbacks see the host's state, and drops the
  deprecated `withParametersWebGL` the wrapper is built on.
