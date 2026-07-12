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
} calculateCentermass;

#define pointsTextureSize calculateCentermass.pointsTextureSize
#define clustersTextureSize calculateCentermass.clustersTextureSize
#else
uniform float pointsTextureSize;
uniform float clustersTextureSize;
#endif

in vec2 pointIndices;

out vec4 rgba;

void main() {
  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  // Payload accumulated per cluster pixel: [sum(x), sum(y), count, sum(z)].
  // The position texture stores z in the alpha channel in 3D mode.
#ifdef SPACE_3D
  rgba = vec4(pointPosition.xy, 1.0, pointPosition.a);
#else
  rgba = vec4(pointPosition.xy, 1.0, 0.0);
#endif

  vec4 pointClusterIndices = texture(clusterTexture, (pointIndices + 0.5) / pointsTextureSize);
  // Unclustered points ([-1, -1]) must not contribute mass to any cluster —
  // vec2(0.0) is the NDC center (a real cluster's texel), so cull them off-screen.
  if (pointClusterIndices.x < 0.0 || pointClusterIndices.y < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  vec2 xy = 2.0 * (pointClusterIndices.xy + 0.5) / clustersTextureSize - 1.0;

  gl_Position = vec4(xy, 0.0, 1.0);
  gl_PointSize = 1.0;
}
