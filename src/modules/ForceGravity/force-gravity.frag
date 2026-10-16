#version 300 es
precision highp float;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceGravityUniforms {
  float gravity;
  vec2 worldOrigin;
  float alpha;
} forceGravity;

#define gravity forceGravity.gravity
#define worldOrigin forceGravity.worldOrigin
#define alpha forceGravity.alpha
#else
uniform float gravity;
uniform vec2 worldOrigin;
uniform float alpha;
#endif

out vec4 fragColor;

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);

  vec4 velocity = vec4(0.0);

  // A linear spring toward the fixed world origin (the centre of the space)
  vec2 distVector = worldOrigin - pointPosition.rg;
  float dist = sqrt(dot(distVector, distVector));
  if (dist > 0.0) {
    float angle = atan(distVector.y, distVector.x);
    float additionalVelocity = alpha * gravity * dist * 0.1;
    velocity.rg += additionalVelocity * vec2(cos(angle), sin(angle));
  }

  fragColor = velocity;
}