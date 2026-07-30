#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D clusterTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateCentermassUniforms {
  float clustersTextureSize;
} calculateCentermass;

#define clustersTextureSize calculateCentermass.clustersTextureSize
#else
uniform float clustersTextureSize;
#endif

in vec2 pointIndices;

out vec4 rgba;

void main() {
  rgba = vec4(0.0);

  ivec2 pointTexel = ivec2(pointIndices);

  // Absent points must not contribute to their cluster's centroid. (exit.G = absent)
  vec4 exitStatus = texelFetch(exitTexture, pointTexel, 0);
  if (exitStatus.g > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  rgba = vec4(pointPosition.xy, 1.0, 0.0);

  vec4 pointClusterIndices = texelFetch(clusterTexture, pointTexel, 0);
  vec2 xy = vec2(0.0);
  if (pointClusterIndices.x >= 0.0 && pointClusterIndices.y >= 0.0) {
    xy = 2.0 * (pointClusterIndices.xy + 0.5) / clustersTextureSize - 1.0;
  }
  
  gl_Position = vec4(xy, 0.0, 1.0);
  gl_PointSize = 1.0;
}
