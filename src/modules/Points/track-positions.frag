#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D trackedIndices;

out vec4 fragColor;

void main() {
  ivec2 trackedTexel = ivec2(gl_FragCoord.xy);

  vec4 trackedPointIndices = texelFetch(trackedIndices, trackedTexel, 0);
  if (trackedPointIndices.r < 0.0) discard;
  vec4 pointPosition = texelFetch(positionsTexture, ivec2(trackedPointIndices.rg), 0);

  fragColor = vec4(pointPosition.rg, 1.0, 1.0);
}

