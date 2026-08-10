#version 300 es
#ifdef GL_ES
precision highp float;
// Fragment shaders default int to mediump, guaranteed only to 32767 —
// point indices go far higher.
precision highp int;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D trackedIndices;

out vec4 fragColor;

void main() {
  ivec2 trackedTexel = ivec2(gl_FragCoord.xy);

  // The table holds raw point indices (-1 = unused slot). The texel is derived
  // here, from the width the positions texture has right now — the grid relayouts
  // when the point count changes, so a texel computed at bake time would keep
  // addressing the old layout. textureSize() is valid here because this shader
  // samples positionsTexture itself.
  float index = texelFetch(trackedIndices, trackedTexel, 0).r;
  if (index < 0.0) discard;

  int i = int(index);
  int w = textureSize(positionsTexture, 0).x;
  // An index past the point count fetches out of range and yields zeros; the
  // CPU readback owns range validation and drops such entries.
  vec4 pointPosition = texelFetch(positionsTexture, ivec2(i % w, i / w), 0);

  fragColor = vec4(pointPosition.rg, 1.0, 1.0);
}
