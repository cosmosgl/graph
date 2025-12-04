#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D centermassTexture;
uniform sampler2D clusterTexture;
uniform sampler2D clusterPositionsTexture;
uniform sampler2D clusterForceCoefficient;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform applyForcesUniforms {
  float alpha;
  float clustersTextureSize;
  float clusterCoefficient;
} applyForces;

#define alpha applyForces.alpha
#define clustersTextureSize applyForces.clustersTextureSize
#define clusterCoefficient applyForces.clusterCoefficient
#else
uniform float alpha;
uniform float clustersTextureSize;
uniform float clusterCoefficient;
#endif

in vec2 textureCoords;

out vec4 fragColor;


void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);
  vec4 pointClusterIndices = texture(clusterTexture, textureCoords);
  // no cluster, so no forces
  if (pointClusterIndices.x >= 0.0 && pointClusterIndices.y >= 0.0) {
    // positioning points to custom cluster position or either to the center of mass
    vec2 clusterPositions = texture(clusterPositionsTexture, pointClusterIndices.xy / clustersTextureSize).xy;
    if (clusterPositions.x < 0.0 || clusterPositions.y < 0.0) {
      vec4 centermassValues = texture(centermassTexture, pointClusterIndices.xy / clustersTextureSize);
      clusterPositions = centermassValues.xy / centermassValues.b;
    }
    vec4 clusterCustomCoeff = texture(clusterForceCoefficient, textureCoords);
    vec2 distVector = clusterPositions.xy - pointPosition.xy;
    float dist = length(distVector);
    if (dist > 0.0) {
      float addV = alpha * dist * clusterCoefficient * clusterCustomCoeff.r;
      velocity.rg += addV * normalize(distVector);
    }
  }

  fragColor = velocity;
}