# Graph interaction comparison method

This method reproduces the original pilot. For matched production timings
with native loops, use the [migration benchmark](#/viewer-comparison?section=doc-migration-benchmark).

The WebGL panel uses the unchanged workspace production `Graph` from its standalone UMD bundle with luma v9.
It runs in a same-origin iframe so the two major luma versions have separate windows.
The WebGPU panel uses the lab's resident luma v10 backend and corrected arithmetic.
Build the current control from the repository root before starting:

```sh
pnpm run build
pnpm --filter @cosmos.gl/gpu-lab dev
```

No production file, shader, dependency or acceptance gate changes. The production graph uses
public host-driven frames (`enableRenderLoop: false`, `renderOneFrame`) and its original
pointer, hover and drag implementation. Both graphs use a completion-paced
host loop. It does not benchmark production's default autonomous scheduler.

## Declared sequence

Native M3, visible inline browser only. Verify actual adapters and rendered canvases
first. Two equal measured CSS-width panels, height 320, actual DPR. Time one backend
at a time, keeping the other paused. No builds/tests during timing.

Use the preselected Karate Club topology (34 points, 78 weighted links), seed 29471,
5,000-tick cooling, gravity 0.25, center 0.1, repulsion 1, friction 0.85, spring strength
1 and distance 10, fixed distance variation, eight samples. Production inputs are
translated by +2048 to its default world origin; candidate coordinates stay around
zero. Production's seeded random stream and float32 translation differ from the
lab's prepared samples. This is a workflow/quality comparison, not a same-input
arithmetic regression. Existing strict numerical gates stay in their experiments.

1. Independently reset each graph. Advance 60 ticks, Fit, measure 300 evolving
   complete frame intervals. Record unweighted graph-distance stress after timing.
2. Continue to tick 5,000, Fit, record geometry/stress, then measure 300 **paused
   redraw** intervals. Low cooled motion and stress alone are not quality approval.
3. Compare frozen candidate geometry through production's public position/camera
   setters. Audit full color/point-ID attachments. Keep the geometry-derived
   one-device-pixel boundary and two-byte interior color gate; report invisible
   point IDs separately. Production host IDs are not its padded pointer-hit policy.
4. While running, switch style A → B → A. A has six-pixel blue circles and grey
   width-1.25 links at alpha 0.45. B makes every third circle coral, ten pixels,
   alpha 0.35, except point 0 at alpha zero; links become coral, width 2.5, alpha 0.7.
   Preserve the supplied colors. Check CPU setter values and candidate GPU pixels.
5. Pick a peripheral point and both hubs, and drag a point while running in each
   panel. Production needs its native hover result before a drag can begin.
   Record actual input callbacks, IDs, visible movement and feedback timings.
6. Replace with a 32-point chain and back; resize to height 280 and back; pause,
   resume, destroy and recreate. Preserve completed evidence in local Export JSON.

## Acceptance and limits

Keep ≥95% of complete intervals within 33 ms, all measured feedback within 50 ms,
exact IDs and no invisible picks. GPU completion plus the next animation opportunity
is a browser proxy, not physical display scanout. Production click feedback begins
at its `click` event and includes application highlighting; candidate picking begins
at `pointerdown`. These are different input paths, not a direct picking speed ratio.
The production event handler requests an additional host frame before measuring GPU completion; this can advance one simulation tick.
Native drag callbacks and visible movement are a bounded behavior check; candidate drag-move latency is not separately instrumented. Layout quality remains measured
and visually reviewed without a new numeric budget. Strict compatibility, first-slice
usability and full migration readiness remain separate; prior failures are retained.

Unsupported candidate options remain explicit: transitions, curved/patterned links,
link picking, images/rings, collision, clusters, attractors, mouse repulsion, automatic
fit, host-device sharing and recovery. Only fixed screen-space sizes and the declared
style/data replacements are exercised. A color/size update is not the full public API.

Resize validation waits for the production ResizeObserver to reach the requested attachment dimensions (at most 120 animation opportunities). This is outside timed windows. Export JSON includes the observed delay and matched-paint geometry. Measurement captures stay local.
