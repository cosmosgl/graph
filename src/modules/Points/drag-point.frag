#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform dragPointUniforms {
  vec2 mousePos;
  float index;
} dragPoint;

#define mousePos dragPoint.mousePos
#define index dragPoint.index
#else
uniform vec2 mousePos;
uniform float index;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);

  // Check if a point is being dragged
  if (index >= 0.0 && index == pointPosition.b) {
    pointPosition.rg = mousePos.rg;
  }

  fragColor = pointPosition;
}