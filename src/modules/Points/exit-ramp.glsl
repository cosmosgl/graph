// Shared by draw-points.vert and draw-highlighted.vert, so the sprite and its hover/focus ring
// fade and mix sizes by one rule. Module code precedes each shader's own uniforms, so they come
// in as parameters; EXIT_DEFAULT_SIZE is a #define injected from variables.ts.

// How gone a point is, 0 = present, 1 = gone, from its exit-texture texel (R = previous absence,
// G = current absence). During a position transition the enter/exit fade blends R→G; otherwise
// the settled G, so an unrelated color or size transition cannot replay the fade.
float exitRamp(vec4 exitStatus, float animatePositions, float transitionProgress) {
  return animatePositions > 0.0 ? mix(exitStatus.r, exitStatus.g, transitionProgress) : exitStatus.g;
}

// A NaN size means "use the default": the config default blended toward the exit default along
// the ramp, so a default-sized point grows in and shrinks out with its fade. Explicit values
// pass through.
float resolveSize(float size, float exit, float pointDefaultSize) {
  return isnan(size) ? mix(pointDefaultSize, EXIT_DEFAULT_SIZE, exit) : size;
}

// The point's size this frame: the source→target mix by progress during a size transition,
// else the target, each resolved along the exit ramp.
float transitionedSize(float sourceSize, float targetSize, float animateSizes, float transitionProgress, float exit, float pointDefaultSize) {
  return animateSizes > 0.0
    ? mix(resolveSize(sourceSize, exit, pointDefaultSize), resolveSize(targetSize, exit, pointDefaultSize), transitionProgress)
    : resolveSize(targetSize, exit, pointDefaultSize);
}
