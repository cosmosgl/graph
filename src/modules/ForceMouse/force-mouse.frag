#version 300 es
precision highp float;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceMouseUniforms {
  float repulsion;
  vec2 mousePos;
} forceMouse;

#define repulsion forceMouse.repulsion
#define mousePos forceMouse.mousePos
#else
uniform float repulsion;
uniform vec2 mousePos;
#endif

out vec4 fragColor;

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 velocity = vec4(0.0);
  vec2 mouse = mousePos;
  // Move particles away from the mouse position using a repulsive force
  vec2 distVector = mouse - pointPosition.rg;
  float dist = sqrt(dot(distVector, distVector));
  dist = max(dist, 10.0);
  float angle = atan(distVector.y, distVector.x);
  float addV = 100.0 * repulsion / (dist * dist);
  velocity.rg -= addV * vec2(cos(angle), sin(angle));

  fragColor = velocity;
}