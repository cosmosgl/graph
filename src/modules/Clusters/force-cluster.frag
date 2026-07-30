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
  float clusterCoefficient;
} applyForces;

#define alpha applyForces.alpha
#define clusterCoefficient applyForces.clusterCoefficient
#else
uniform float alpha;
uniform float clusterCoefficient;
#endif

out vec4 fragColor;


void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 velocity = vec4(0.0);
  vec4 pointClusterIndices = texelFetch(clusterTexture, pointTexel, 0);
  // no cluster, so no forces
  if (pointClusterIndices.x >= 0.0 && pointClusterIndices.y >= 0.0) {
    // clusterTexture stores whole texel coordinates, so truncating to int is exact.
    ivec2 clusterTexel = ivec2(pointClusterIndices.xy);
    // positioning points to custom cluster position or either to the center of mass
    vec2 clusterPositions = texelFetch(clusterPositionsTexture, clusterTexel, 0).xy;
    if (clusterPositions.x < 0.0 || clusterPositions.y < 0.0) {
      vec4 centermassValues = texelFetch(centermassTexture, clusterTexel, 0);
      clusterPositions = centermassValues.xy / centermassValues.b;
    }
    vec4 clusterCustomCoeff = texelFetch(clusterForceCoefficient, pointTexel, 0);
    vec2 distVector = clusterPositions.xy - pointPosition.xy;
    float dist = length(distVector);
    if (dist > 0.0) {
      float addV = alpha * dist * clusterCoefficient * clusterCustomCoeff.r;
      velocity.rg += addV * normalize(distVector);
    }
  }

  fragColor = velocity;
}