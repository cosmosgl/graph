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

in vec2 textureCoords;
out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);
  vec2 mouse = mousePos;
  // Move particles away from the mouse position using a repulsive force.
  // A point exactly at the mouse position has no direction — atan(0.0, 0.0)
  // is undefined per the GLSL spec and can produce NaN velocity that
  // friction never removes.
  vec2 distVector = mouse - pointPosition.rg;
  float l = dot(distVector, distVector);
  if (l > 0.0) {
    float dist = max(sqrt(l), 10.0);
    float angle = atan(distVector.y, distVector.x);
    float addV = 100.0 * repulsion / (dist * dist);
    velocity.rg -= addV * vec2(cos(angle), sin(angle));
  }

  fragColor = velocity;
}