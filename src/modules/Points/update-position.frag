#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D velocity;
uniform sampler2D pinnedStatusTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform updatePositionUniforms {
  float friction;
  float maxStep;
} updatePosition;

#define friction updatePosition.friction
#define maxStep updatePosition.maxStep
#else
uniform float friction;
uniform float maxStep;
#endif

out vec4 fragColor;

// Neither component is NaN or an infinity. Read from the exponent bits, as the
// data bounds do (reduce-bounds-buckets.frag): ANGLE's Metal backend compiles
// with fast math, which may assume no NaNs and fold a comparison-based test
// away. Only ever applied to a value loaded from a texture, which a compiler
// cannot assume to be finite.
bool isFiniteVector(vec2 v) {
  uvec2 exponent = floatBitsToUint(v) & 0x7f800000u;
  return all(notEqual(exponent, uvec2(0x7f800000u)));
}

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 pointVelocity = texelFetch(velocity, pointTexel, 0);

  // Check if point is pinned
  // pinnedStatusTexture has the same size and layout as positionsTexture
  // Each pixel corresponds to a point: red channel > 0.5 means the point is pinned
  vec4 pinnedStatus = texelFetch(pinnedStatusTexture, pointTexel, 0);
  
  // If pinned, don't update position
  if (pinnedStatus.r > 0.5) {
    fragColor = pointPosition;
    return;
  }

  // If absent (current absence = exit.G), leave it untouched — don't integrate
  // it (a NaN position plus a step is still NaN, and the point must keep it).
  vec4 exitStatus = texelFetch(exitTexture, pointTexel, 0);
  if (exitStatus.g > 0.5) {
    fragColor = pointPosition;
    return;
  }

  // Positions are not bounded: a layout grows as far as its forces take it, and
  // `spaceSize` only places the world origin. What is bounded is one sub-step.
  //
  // A non-finite velocity is dropped — the point does not move this sub-step.
  // There is no direction in a NaN or an infinity to keep, and integrating one
  // would leave the position non-finite for good, and with it, through the
  // many-body and collision sums, every other point's forces. This, not the
  // length bound below, is what guards against a diverged force: positions
  // start finite (an infinite input coordinate is placed on the space's edge
  // when it is uploaded) and a finite step keeps them finite.
  if (!isFiniteVector(pointVelocity.rg)) {
    fragColor = pointPosition;
    return;
  }

  // A step longer than maxStep is shortened to maxStep, keeping its direction.
  // maxStep is the width of the space: the displacement ceiling the position
  // clamp this replaces implied, since neither coordinate of a point inside the
  // space could move further than that in one sub-step. It is not a stability
  // bound — a 4096-unit step contains nothing — only a ceiling on how far one
  // runaway sub-step throws a point.
  //
  // The step is velocity × friction (at most 1). Its length is never more than
  // √2 times its largest component, so only a step whose largest component
  // exceeds half of maxStep can be too long, and only those take the length —
  // off a direction scaled to that component, so it cannot overflow however
  // large a finite velocity is. The step itself is formed only on the common
  // path below, exactly as it always was, so a step whose largest component is
  // at most half of maxStep — every step of a settling layout — moves a point by
  // the same bits as before. A step past that half that still fits the bound
  // takes the same path, but a compiler may then fuse its friction and position
  // update into one rounding (ANGLE's Metal backend does): a last-bit
  // difference, and only on steps of thousands of units.
  float largestVelocity = max(abs(pointVelocity.r), abs(pointVelocity.g));
  float largest = largestVelocity * abs(friction);
  if (largest > 0.5 * maxStep) {
    // Brought below 1e30 before dividing by its largest component: under fast
    // math a division by a value past 2^126 can go through its reciprocal, a
    // denormal, flushed to zero — and the direction with it.
    vec2 scaled = largestVelocity > 1.0e30 ? pointVelocity.rg * 1.0e-30 : pointVelocity.rg;
    vec2 direction = scaled / max(abs(scaled.x), abs(scaled.y)) * sign(friction);
    float directionLength = length(direction); // 1 … √2
    if (largest > maxStep / directionLength) {
      pointPosition.rg += direction * (maxStep / directionLength);
      fragColor = pointPosition;
      return;
    }
  }

  // Friction
  pointVelocity.rg *= friction;

  pointPosition.rg += pointVelocity.rg;

  fragColor = pointPosition;
}
