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
  float cellSize;
} forceCenter;

#define levelTextureSize forceCenter.levelTextureSize
#define repulsion forceCenter.repulsion
#define alpha forceCenter.alpha
#define cellSize forceCenter.cellSize
#else
uniform float levelTextureSize;
uniform float alpha;
uniform float repulsion;
uniform float cellSize;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Calculate the additional velocity based on the center of mass
vec2 calculateAdditionalVelocity (vec2 ij, vec2 pp) {
  vec2 add = vec2(0.0);
  vec4 centermass = texture(levelFbo, ij);
  // b is the point count — the only reliable occupancy signal. r/g are
  // coordinate sums, which are legitimately 0 for points on the space boundary.
  if (centermass.b > 0.0) {
    vec2 centermassPosition = vec2(centermass.rg / centermass.b);
    vec2 distVector = pp - centermassPosition;
    float l = dot(distVector, distVector);
    float dist = sqrt(l);
    if (l > 0.0) {
      float angle = atan(distVector.y, distVector.x);
      float c = alpha * repulsion * centermass.b;

      float distanceMin2 = 1.0;
      if (l < distanceMin2) l = sqrt(distanceMin2 * l);
      float addV = c / sqrt(l);
      add = addV * vec2(cos(angle), sin(angle));
    }
  }
  return add;
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 random = texture(randomValues, textureCoords);

  vec4 velocity = vec4(0.0);

  // Sample the centermass of the cell containing this point. The cell index is
  // pos / cellSize; +0.5 targets the texel center (cellSize is 1 only when the
  // space size is a power of two, so pos / levelTextureSize would read the
  // wrong cell otherwise).
  // Clamp mirrors the binning in calculate-level.vert so a point on the far
  // space boundary reads the cell it was actually accumulated into.
  vec2 cellIndex = clamp(floor(pointPosition.xy / cellSize), 0.0, levelTextureSize - 1.0);
  velocity.xy += calculateAdditionalVelocity((cellIndex + 0.5) / levelTextureSize, pointPosition.xy);
  // Apply random factor to the velocity
  velocity.xy += velocity.xy * random.rg;

  fragColor = velocity;
}