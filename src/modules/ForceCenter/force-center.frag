#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D centermassTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCenterUniforms {
  float centerForce;
  float alpha;
} forceCenter;

#define centerForce forceCenter.centerForce
#define alpha forceCenter.alpha
#else
uniform float centerForce;
uniform float alpha;
#endif

out vec4 fragColor;

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 velocity = vec4(0.0);
  vec4 centermassValues = texelFetch(centermassTexture, ivec2(0), 0);
  vec2 centermassPosition = centermassValues.xy / centermassValues.b;
  vec2 distVector = centermassPosition - pointPosition.xy;
  float dist = sqrt(dot(distVector, distVector));
  if (dist > 0.0) {
    float angle = atan(distVector.y, distVector.x);
    float addV = alpha * centerForce * dist * 0.01;
    velocity.rg += addV * vec2(cos(angle), sin(angle));
  }

  fragColor = velocity;
}