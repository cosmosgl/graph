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
  float pixelRatio;
} drawHighlighted;

#define width drawHighlighted.width
#else
uniform float width;
uniform float pixelRatio;
#endif

in vec2 vertexPosition;
in float pointOpacity;
in vec3 rgbColor;
flat in float ringRadiusPx;
flat in float quadHalfPx;

out vec4 fragColor;

// Ring band [sqrt(width) × R, R], R the outer radius in device px (`width` is the inner
// edge as a squared radius). Core at least EDGE_RAMP_PX wide, centred on the band, ramp
// centred on both edges. A ring is an interface mark: thinner than the ramp it is widened
// at full alpha, not dimmed.
void main () {
  float rPx = length(vertexPosition) * quadHalfPx;
  float innerPx = sqrt(width) * ringRadiusPx;
  float centrePx = (ringRadiusPx + innerPx) * 0.5;
  float halfCorePx = max(ringRadiusPx - innerPx, EDGE_RAMP_PX) * 0.5;
  float ring = 1.0 - smoothstep(-EDGE_RAMP_PX * 0.5, EDGE_RAMP_PX * 0.5, abs(rPx - centrePx) - halfCorePx);
  fragColor = vec4(rgbColor, ring * pointOpacity);
}