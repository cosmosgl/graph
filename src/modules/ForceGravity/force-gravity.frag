#version 300 es
precision highp float;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceGravityUniforms {
  float gravity;
  float spaceSize;
  float alpha;
} forceGravity;

#define gravity forceGravity.gravity
#define spaceSize forceGravity.spaceSize
#define alpha forceGravity.alpha
#else
uniform float gravity;
uniform float spaceSize;
uniform float alpha;
#endif

in vec2 textureCoords;
out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);

  vec4 velocity = vec4(0.0);

  #ifdef SPACE_3D
  // 3D: z lives in the position alpha channel; z velocity goes to the blue channel.
  vec3 centerPosition = vec3(spaceSize * 0.5);
  vec3 position = vec3(pointPosition.rg, pointPosition.a);
  vec3 distVector = centerPosition - position;
  float dist = length(distVector);
  if (dist > 0.0) {
    float additionalVelocity = alpha * gravity * dist * 0.1;
    velocity.rgb += additionalVelocity * (distVector / dist);
  }
  #else
  vec2 centerPosition = vec2(spaceSize * 0.5);
  vec2 distVector = centerPosition - pointPosition.rg;
  float dist = sqrt(dot(distVector, distVector));
  if (dist > 0.0) {
    float angle = atan(distVector.y, distVector.x);
    float additionalVelocity = alpha * gravity * dist * 0.1;
    velocity.rg += additionalVelocity * vec2(cos(angle), sin(angle));
  }
  #endif

  fragColor = velocity;
}