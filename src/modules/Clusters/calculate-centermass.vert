#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D clusterTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateCentermassUniforms {
  float pointsTextureSize;
  float clustersTextureSize;
} calculateCentermassUniforms;

#define pointsTextureSize calculateCentermassUniforms.pointsTextureSize
#define clustersTextureSize calculateCentermassUniforms.clustersTextureSize
#else
uniform float pointsTextureSize;
uniform float clustersTextureSize;
#endif

in vec2 pointIndices;

out vec4 rgba;

void main() {
  vec4 pointPosition = texture(positionsTexture, pointIndices / pointsTextureSize);
  rgba = vec4(pointPosition.xy, 1.0, 0.0);

  vec4 pointClusterIndices = texture(clusterTexture, pointIndices / pointsTextureSize);
  vec2 xy = vec2(0.0);
  if (pointClusterIndices.x >= 0.0 && pointClusterIndices.y >= 0.0) {
    xy = 2.0 * (pointClusterIndices.xy + 0.5) / clustersTextureSize - 1.0;
  }
  
  gl_Position = vec4(xy, 0.0, 1.0);
  gl_PointSize = 1.0;
}
