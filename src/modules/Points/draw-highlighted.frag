#version 300 es
#ifdef GL_ES
precision highp float;
#endif

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawHighlightedUniforms {
  float size;
  mat4 transformationMatrix;
  float pointsTextureSize;
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  float scalePointsOnZoom;
  float pointIndex;
  float maxPointSize;
  vec4 color;
  float universalPointOpacity;
  float greyoutOpacity;
  float isDarkenGreyout;
  vec4 backgroundColor;
  vec4 greyoutColor;
  float width;
} drawHighlighted;

#define width drawHighlighted.width
#else
uniform float width;
#endif

in vec2 vertexPosition;
in float pointOpacity;
in vec3 rgbColor;

out vec4 fragColor;

const float smoothing = 1.05;

void main () {
  float r = dot(vertexPosition, vertexPosition);
  float opacity = smoothstep(r, r * smoothing, 1.0);
  float stroke = smoothstep(width, width * smoothing, r);
  fragColor = vec4(rgbColor, opacity * stroke * pointOpacity);
}