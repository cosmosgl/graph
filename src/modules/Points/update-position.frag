#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D velocity;
uniform sampler2D pinnedStatusTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform updatePositionUniforms {
  float friction;
  float spaceSize;
} updatePosition;

#define friction updatePosition.friction
#define spaceSize updatePosition.spaceSize
#else
uniform float friction;
uniform float spaceSize;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 pointVelocity = texture(velocity, textureCoords);

  // Check if point is pinned
  // pinnedStatusTexture has the same size and layout as positionsTexture
  // Each pixel corresponds to a point: red channel > 0.5 means the point is pinned
  vec4 pinnedStatus = texture2D(pinnedStatusTexture, textureCoords);
  
  // If pinned, don't update position
  if (pinnedStatus.r > 0.5) {
    gl_FragColor = pointPosition;
    return;
  }

  // Friction
  pointVelocity.rg *= friction;

  pointPosition.rg += pointVelocity.rg;

  pointPosition.r = clamp(pointPosition.r, 0.0, spaceSize);
  pointPosition.g = clamp(pointPosition.g, 0.0, spaceSize);
  
  fragColor = pointPosition;
}