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

in vec2 textureCoords;
out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);
  vec4 centermassValues = texture(centermassTexture, vec2(0.0));

  #ifdef SPACE_3D
  // Centermass accumulates [sum(x), sum(y), count, sum(z)]; z velocity goes to blue.
  vec3 centermassPosition = vec3(centermassValues.xy, centermassValues.a) / centermassValues.b;
  vec3 position = vec3(pointPosition.xy, pointPosition.a);
  vec3 distVector = centermassPosition - position;
  float dist = length(distVector);
  if (dist > 0.0) {
    float addV = alpha * centerForce * dist * 0.01;
    velocity.rgb += addV * (distVector / dist);
  }
  #else
  vec2 centermassPosition = centermassValues.xy / centermassValues.b;
  vec2 distVector = centermassPosition - pointPosition.xy;
  float dist = sqrt(dot(distVector, distVector));
  if (dist > 0.0) {
    float angle = atan(distVector.y, distVector.x);
    float addV = alpha * centerForce * dist * 0.01;
    velocity.rg += addV * vec2(cos(angle), sin(angle));
  }
  #endif

  fragColor = velocity;
}