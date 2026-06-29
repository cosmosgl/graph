#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateCentermassUniforms {
  float pointsTextureSize;
} calculateCentermass;

#define pointsTextureSize calculateCentermass.pointsTextureSize
#else
uniform float pointsTextureSize;
#endif

in vec2 pointIndices;

out vec4 rgba;

void main() {
  rgba = vec4(0.0);

  // Absent points must not contribute to the centroid — a NaN position would
  // poison the sum and break the force for every point. (exit.G = current absence)
  vec4 exitStatus = texture(exitTexture, pointIndices / pointsTextureSize);
  if (exitStatus.g > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 pointPosition = texture(positionsTexture, pointIndices / pointsTextureSize);
  rgba = vec4(pointPosition.xy, 1.0, 0.0);

  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
