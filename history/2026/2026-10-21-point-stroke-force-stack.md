<!-- suggested path: history/2026/2026-10-21-point-stroke-force-stack.md -->

# Point strokes and force changes in one PR stack

**Date:** 2026-10-21
**Commits:** `fix(force): stack unbounded space on pairwise collision constraints` (`603af81`) — the stack's four merge commits were folded into it when the stack was rebased linear; final integration in [#282](https://github.com/cosmosgl/graph/pull/282).

The five branches were developed against different versions of `main`. Stacking
#267 → #270 → #280 → #281 → #282 needs their behavior to compose, rather than
resolving each conflict by retaining one branch's entire implementation.

The stroke renderer keeps the current render-order and host-picking inputs.
Its attributes and uniforms reach every draw through the shared helpers.
Attractors move into `GraphSimulation`, which now owns the forces; `Graph`
delegates its setters there. Both entry points are covered through simulation
recreation. The pending-input rebuild fix continues to resolve every channel
before its resources are sized and uploaded.

The collision conflict is the consequential one. The constraint branch replaced
cell-average contacts with exact all-pairs below 4,096 points and depth-peeled
point slots above. The unbounded-space branch independently replaced the old
space-anchored average grid with a rotated hash on unbounded cell indices.
Keeping either implementation wholesale would lose the other's guarantee.

The combined slot path therefore uses contact-sized cells counted from the
world origin (`collision-grid.ts`), with the rotated hash mapping them onto
point-count-bounded slot textures; nothing about the layout is measured before
a pass, so a distant outlier changes nothing for the rest of the points. Hash
aliases share the sample budget, but each candidate's world cell is
checked before resolving contact, so aliases cannot create phantom pushes or
count a neighbour twice. Small graphs keep exact all-pairs, and both paths keep
iterations, cooling, radius-aware spring lengths and friction-free corrections.
The old cell-average hash's performance and accuracy measurements remain a
record of that implementation; they do not benchmark the combined slot path.

A 5,001-point regression case checks overlapping pairs at negative and far-out
coordinates with an outlier 200,000 units away. The translated-layout test checks
one correction pass: repeated pairwise projections amplify float32 input
rounding, so identical long-run point coordinates are not its contract.
