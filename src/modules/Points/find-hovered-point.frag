#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec4 rgba;

out vec4 fragColor;

void main() {
  #ifdef SPACE_3D
  // 3D packs [index, x, y, z] — validity is index >= 0 (x/y/z can legitimately be <= 0).
  if (rgba.r < 0.0) {
    discard;
  }
  #else
  if (rgba.g <= 0.0) {
    discard;
  }
  #endif
  fragColor = rgba;
}