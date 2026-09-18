#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
// Per point: (targetX, targetY, strength, hasTarget). `hasTarget` is 0 for a point
// without an attractor, so the pass writes zero velocity for it.
uniform sampler2D attractorTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceAttractorUniforms {
  float alpha;
  float attractionCoefficient;
} forceAttractor;

#define alpha forceAttractor.alpha
#define attractionCoefficient forceAttractor.attractionCoefficient
#else
uniform float alpha;
uniform float attractionCoefficient;
#endif

out vec4 fragColor;

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 attractor = texelFetch(attractorTexture, pointTexel, 0);
  vec4 velocity = vec4(0.0);

  // no attractor, so no force
  if (attractor.a > 0.5) {
    vec2 distVector = attractor.xy - pointPosition.xy;
    float dist = length(distVector);
    // `dist > 0.0` is also false for NaN, so an absent (NaN-positioned) point
    // contributes no velocity instead of poisoning the integrator.
    if (dist > 0.0) {
      float addV = alpha * dist * attractionCoefficient * attractor.b;
      velocity.rg += addV * normalize(distVector);
    }
  }

  fragColor = velocity;
}
