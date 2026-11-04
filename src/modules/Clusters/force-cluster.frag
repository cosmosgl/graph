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
    // Pulled to the cluster's custom position if it has one (.z = 1, set on the CPU:
    // any coordinate, negative ones included, is a position), else to its centre of mass
    vec3 clusterPosition = texelFetch(clusterPositionsTexture, clusterTexel, 0).xyz;
    vec2 clusterPositions = clusterPosition.xy;
    if (clusterPosition.z < 0.5) {
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