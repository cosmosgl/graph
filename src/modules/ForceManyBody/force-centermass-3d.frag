#version 300 es
precision highp float;

// Near-field pass of the 3D octree repulsion, mirroring the 2D force-centermass
// fallback. After the finest level pass, the only un-accumulated region is the 3³
// neighborhood of the point's cell at the finest grid: 26 neighbor cells sampled as
// full centroids plus the point's own cell as its centroid *including* the point
// itself (like the 2D fallback — the force vanishes when the point sits exactly at
// the centroid, and the random jitter below unsticks that equilibrium).

uniform sampler2D positionsTexture;
uniform sampler2D levelTexture;
uniform sampler2D randomValues;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCentermass3DUniforms {
  float levelGridSize;
  float cellSize;
  float tilesPerRow;
  float alpha;
  float repulsion;
} forceCentermass3D;

#define levelGridSize forceCentermass3D.levelGridSize
#define cellSize forceCentermass3D.cellSize
#define tilesPerRow forceCentermass3D.tilesPerRow
#define alpha forceCentermass3D.alpha
#define repulsion forceCentermass3D.repulsion
#else
uniform float levelGridSize;
uniform float cellSize;
uniform float tilesPerRow;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Same per-cell math as force-level-3d.frag (must stay identical).
vec3 cellVelocity(ivec3 cell, int gridSize, int rowTiles, vec3 position) {
  ivec2 pixel = ivec2(
    (cell.z % rowTiles) * gridSize + cell.x,
    (cell.z / rowTiles) * gridSize + cell.y
  );
  vec4 centermass = texelFetch(levelTexture, pixel, 0);
  if (centermass.b <= 0.0) return vec3(0.0);
  vec3 centermassPosition = vec3(centermass.r, centermass.g, centermass.a) / centermass.b;
  vec3 distVector = position - centermassPosition;
  float l = dot(distVector, distVector);
  if (l <= 0.0) return vec3(0.0);
  float distanceMin2 = 1.0;
  if (l < distanceMin2) l = sqrt(distanceMin2 * l);
  float addV = alpha * repulsion * centermass.b / sqrt(l);
  return addV * normalize(distVector);
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec3 position = vec3(pointPosition.rg, pointPosition.a);
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
        velocity += cellVelocity(cell, gridSize, rowTiles, position);
      }
    }
  }

  // Random jitter proportional to the velocity, like the 2D centermass fallback.
  velocity += velocity * random.rgb;

  // z velocity lives in the blue channel (update-position.frag SPACE_3D contract).
  fragColor = vec4(velocity, 0.0);
}
