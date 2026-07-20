#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D velocity;
uniform sampler2D pinnedStatusTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform updatePositionUniforms {
  float friction;
  float spaceSize;
  float maxForce;
} updatePosition;

#define friction updatePosition.friction
#define spaceSize updatePosition.spaceSize
#define maxForce updatePosition.maxForce
#else
uniform float friction;
uniform float spaceSize;
uniform float maxForce;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 pointVelocity = texture(velocity, textureCoords);

  // Check if point is pinned
  // pinnedStatusTexture has the same size and layout as positionsTexture
  // Each pixel corresponds to a point: red channel > 0.5 means the point is pinned
  vec4 pinnedStatus = texture(pinnedStatusTexture, textureCoords);
  
  // If pinned, don't update position
  if (pinnedStatus.r > 0.5) {
    fragColor = pointPosition;
    return;
  }

  // t-SNE gradient clipping (maxForce > 0 only in the t-SNE kernel): cap the
  // per-tick displacement magnitude, exactly as reference t-SNE clips the
  // gradient each step. Without it the lagged-Z repulsion feedback, or a
  // weakly-connected point, can fling a point across the whole space in a few
  // ticks; the cap bounds the step while preserving its direction. The alpha
  // channel (the t-SNE Z partial sum) is untouched — and already consumed by
  // the Z reduction before this pass runs.
  if (maxForce > 0.0) {
    #ifdef SPACE_3D
    vec3 step = vec3(pointVelocity.r, pointVelocity.g, pointVelocity.b);
    float stepMag = length(step);
    if (stepMag > maxForce) {
      step *= maxForce / stepMag;
      pointVelocity.r = step.x;
      pointVelocity.g = step.y;
      pointVelocity.b = step.z;
    }
    #else
    float stepMag = length(pointVelocity.rg);
    if (stepMag > maxForce) pointVelocity.rg *= maxForce / stepMag;
    #endif
  }

  // Friction
  pointVelocity.rg *= friction;

  pointPosition.rg += pointVelocity.rg;

  pointPosition.r = clamp(pointPosition.r, 0.0, spaceSize);
  pointPosition.g = clamp(pointPosition.g, 0.0, spaceSize);

  #ifdef SPACE_3D
  // The z coordinate lives in the position alpha channel and its velocity in
  // the velocity blue channel; integrate and clamp it like x and y.
  pointVelocity.b *= friction;
  pointPosition.a += pointVelocity.b;
  pointPosition.a = clamp(pointPosition.a, 0.0, spaceSize);
  #endif

  fragColor = pointPosition;
}