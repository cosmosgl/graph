#version 300 es
precision highp float;

in vec4 pointColor;
out vec4 fragmentColor;

void main() {
  vec2 local = gl_PointCoord * 2.0 - 1.0;
  float radius = length(local);
  float feather = max(fwidth(radius), 0.01);
  float coverage = 1.0 - smoothstep(1.0 - feather, 1.0, radius);
  if (coverage <= 0.0) discard;
  fragmentColor = vec4(pointColor.rgb, pointColor.a * coverage);
}
