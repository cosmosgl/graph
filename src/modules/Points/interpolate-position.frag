#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D sourceTexture;
uniform sampler2D targetTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform interpolatePositionUniforms {
  float progress;
} interpolatePosition;

#define progress interpolatePosition.progress
#else
uniform float progress;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 source = texture(sourceTexture, textureCoords);
  vec4 target = texture(targetTexture, textureCoords);
  // NaN means absent (ingest normalizes half-NaN to full-NaN, so checking one
  // channel suffices). Hold the real side so the point stays put while it fades,
  // never interpolating to/from NaN:
  //   · exiting  (target NaN): freeze at source.
  //   · entering (source NaN): appear at target (no slide in from NaN).
  vec2 src = isnan(source.r) ? target.rg : source.rg;
  vec2 tgt = isnan(target.r) ? src : target.rg;
  vec2 position = mix(src, tgt, progress);
  fragColor = vec4(position, source.b, 1.0);
}
