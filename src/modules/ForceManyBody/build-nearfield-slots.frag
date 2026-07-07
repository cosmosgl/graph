#version 300 es
precision highp float;

in vec2 slotData;
out vec4 fragColor;

void main() {
  fragColor = vec4(slotData, 0.0, 0.0);
}
