---
source: Recorded findings
recorded: 9 and 19 November 2026
device: Apple M3, ANGLE Metal WebGL and Apple WebGPU
scope: Weighted directional springs on bounded fixtures, including 100,000-point WebGL stars
---

# Weighted spring evidence

Both GPU backends passed ten ticks on the 128-point star. At tick ten their
checked outputs matched each other exactly and differed from the CPU by at most
about `6 × 10⁻⁸`.

The 2,048-point multi-hub graph with 4,091 links also passed ten ticks; its
largest WebGL/WebGPU difference at tick ten was about `9 × 10⁻⁸`.

## Larger WebGL star

On 19 November 2026, a Lab version on the same GPU split high-degree spring work into
bounded passes. Two 100,000-point WebGL star runs completed 25 ticks and
passed the CPU checks at ticks 1, 10 and 25. An earlier direct-path run lost
its WebGL context; its cause remains unresolved. These observations do not
establish the behavior of the full production engine.

## What was compared

The CPU reference uses independently constructed edge lists. Each incoming and
outgoing spring pass and the integration step between them was checked against
the existing tolerances. The eight-point edge-case fixture also passed ten ticks
with the collision rest-length floor enabled, before and after replacing links.

These checks support the selected spring semantics on one device and bounded
fixtures. They do not establish large-graph speedups or complete engine behavior.
