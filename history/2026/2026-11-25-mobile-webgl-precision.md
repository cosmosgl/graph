# Mobile WebGL precision in the research network

The arXiv coauthorship example seeds authors near their communities. On a Realme 10 those groups looked plausible even though the layout had stalled. Comparing the same initial positions after 120 steps exposed the difference. The median author moved 0.55 graph units on the phone and 327.54 on the Mac.

The position shader reads the exponent bits of each velocity to discard NaNs and infinities. With the default integer precision on the Mali-G57 MC2, that check discarded finite velocities too. Numeric texture reads also rounded fractional coordinates despite the textures storing 32-bit floats. Requesting high precision for both operations let the median author move 327.26 units on the phone.

A third-party font stylesheet caused a separate startup delay. The showcase now serves Inter with the site and renders in its fallback font while Inter loads. Holding the font response open confirmed that the graph can start in the meantime. [Website PR #301](https://github.com/cosmosgl/graph/pull/301)

[PR #302](https://github.com/cosmosgl/graph/pull/302)
