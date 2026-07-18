#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D levelFbo;
uniform sampler2D randomValues;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCenterUniforms {
  float levelTextureSize;
  float alpha;
  float repulsion;
} forceCenter;

#define levelTextureSize forceCenter.levelTextureSize
#define repulsion forceCenter.repulsion
#define alpha forceCenter.alpha
#else
uniform float levelTextureSize;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Calculate the additional velocity based on the center of mass
vec2 calculateAdditionalVelocity (vec2 ij, vec2 pp) {
  vec2 add = vec2(0.0);
  vec4 centermass = texture(levelFbo, ij);
  if (centermass.r > 0.0 && centermass.g > 0.0 && centermass.b > 0.0) {
    vec2 centermassPosition = vec2(centermass.rg / centermass.b);
    vec2 distVector = pp - centermassPosition;
    float l = dot(distVector, distVector);
    float dist = sqrt(l);
    if (l > 0.0) {
      #ifdef UMAP_KERNEL
      // UMAP repulsive gradient — must stay identical to force-level.frag.
      float d2 = l / (UMAP_SCALE * UMAP_SCALE);
      float coeff = 2.0 * UMAP_B / ((0.001 + d2) * (1.0 + UMAP_A * pow(d2, UMAP_B)));
      add = alpha * repulsion * centermass.b * UMAP_SCALE * clamp(coeff * distVector / UMAP_SCALE, -4.0, 4.0);
      #else
      float angle = atan(distVector.y, distVector.x);
      float c = alpha * repulsion * centermass.b;

      float distanceMin2 = 1.0;
      if (l < distanceMin2) l = sqrt(distanceMin2 * l);
      float addV = c / sqrt(l);
      add = addV * vec2(cos(angle), sin(angle));
      #endif
    }
  }
  return add;
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 random = texture(randomValues, textureCoords);

  vec4 velocity = vec4(0.0);

  // Calculate additional velocity based on the point position
  velocity.xy += calculateAdditionalVelocity(pointPosition.xy / levelTextureSize, pointPosition.xy);
  // Apply random factor to the velocity
  velocity.xy += velocity.xy * random.rg;

  fragColor = velocity;
}