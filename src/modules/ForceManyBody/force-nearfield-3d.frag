#version 300 es
precision highp float;

// Near-field pass of the 3D octree repulsion (P3M-style). After the finest level
// pass, the only un-accumulated region is the 3³ neighborhood of the point's cell.
// Cell centroids alone exert a purely radial force there, which flattens dense
// hubs into disks and spikes — so each cell contributes:
//   - exact point-to-point forces from up to K depth-peeled points (a random
//     subset re-drawn every tick by build-nearfield-slots.vert, so all points of
//     a dense cell get pairwise treatment over successive ticks), and
//   - the residual centroid of the remaining, un-peeled mass (aggregate minus
//     the peeled points), so no mass is ever lost.
// The point itself is skipped in the pairwise sum and, when peeled, excluded
// from the residual too.

uniform sampler2D positionsTexture;
uniform sampler2D levelTexture;
uniform sampler2D randomValues;
uniform sampler2D slotTexture0;
uniform sampler2D slotTexture1;
uniform sampler2D slotTexture2;
uniform sampler2D slotTexture3;
uniform sampler2D slotTexture4;
uniform sampler2D slotTexture5;
uniform sampler2D slotTexture6;
uniform sampler2D slotTexture7;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceNearField3DUniforms {
  float pointsTextureSize;
  float levelGridSize;
  float cellSize;
  float tilesPerRow;
  float alpha;
  float repulsion;
} forceNearField3D;

#define pointsTextureSize forceNearField3D.pointsTextureSize
#define levelGridSize forceNearField3D.levelGridSize
#define cellSize forceNearField3D.cellSize
#define tilesPerRow forceNearField3D.tilesPerRow
#define alpha forceNearField3D.alpha
#define repulsion forceNearField3D.repulsion
#else
uniform float pointsTextureSize;
uniform float levelGridSize;
uniform float cellSize;
uniform float tilesPerRow;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Same clamped inverse-distance falloff as the level passes (must stay identical).
vec3 pairwiseVelocity(vec3 position, vec3 otherPosition, float mass) {
  vec3 distVector = position - otherPosition;
  float l = dot(distVector, distVector);
  if (l <= 0.0) return vec3(0.0);
  float distanceMin2 = 1.0;
  if (l < distanceMin2) l = sqrt(distanceMin2 * l);
  float addV = alpha * repulsion * mass / sqrt(l);
  return addV * normalize(distVector);
}

// Processes one peeled slot of a cell: adds the exact pairwise force (skipping
// the point itself) and removes the peeled point from the cell's residual.
vec3 slotVelocity(vec2 slot, vec3 position, float selfIndex, inout vec4 residual) {
  float index = slot.x;
  if (index < 0.0) return vec3(0.0);
  int size = int(pointsTextureSize);
  int i = int(index);
  vec4 other = texelFetch(positionsTexture, ivec2(i % size, i / size), 0);
  residual -= vec4(other.rg, 1.0, other.a);
  if (index == selfIndex) return vec3(0.0);
  return pairwiseVelocity(position, vec3(other.rg, other.a), 1.0);
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec3 position = vec3(pointPosition.rg, pointPosition.a);
  float selfIndex = pointPosition.b;
  vec4 random = texture(randomValues, textureCoords);

  int gridSize = int(levelGridSize);
  int rowTiles = int(tilesPerRow);
  ivec3 pointCell = clamp(ivec3(floor(position / cellSize)), ivec3(0), ivec3(gridSize - 1));

  vec3 velocity = vec3(0.0);

  for (int k = -1; k <= 1; k += 1) {
    for (int j = -1; j <= 1; j += 1) {
      for (int i = -1; i <= 1; i += 1) {
        ivec3 cell = pointCell + ivec3(i, j, k);
        if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, ivec3(gridSize)))) continue;
        ivec2 pixel = ivec2(
          (cell.z % rowTiles) * gridSize + cell.x,
          (cell.z / rowTiles) * gridSize + cell.y
        );

        // [sum(x), sum(y), count, sum(z)] — becomes the residual as slots are removed
        vec4 residual = texelFetch(levelTexture, pixel, 0);
        if (residual.b <= 0.0) continue;

        // Sampler arrays cannot be indexed dynamically in GLSL ES 3.0 — unrolled.
        velocity += slotVelocity(texelFetch(slotTexture0, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture1, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture2, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture3, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture4, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture5, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture6, pixel, 0).rg, position, selfIndex, residual);
        velocity += slotVelocity(texelFetch(slotTexture7, pixel, 0).rg, position, selfIndex, residual);

        // Un-peeled remainder acts through its centroid (0.5 guards float dust).
        if (residual.b > 0.5) {
          velocity += pairwiseVelocity(position, vec3(residual.r, residual.g, residual.a) / residual.b, residual.b);
        }
      }
    }
  }

  // Random jitter proportional to the velocity, like the 2D centermass fallback.
  velocity += velocity * random.rgb;

  // z velocity lives in the blue channel (update-position.frag SPACE_3D contract).
  fragColor = vec4(velocity, 0.0);
}
