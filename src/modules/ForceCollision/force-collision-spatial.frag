#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D gridTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCollisionUniforms {
  float pointsTextureSize;
  float gridTextureSize;   // Cells per axis
  float cellSize;
  float alpha;
  float collisionStrength;
  float collisionRadius;
  float collisionPadding;
  float pointsNumber;
  float tilesPerRow;        // 3D only: z-slices per texture row (tiled layout)
  float passesCount;        // Number of offset passes the force is split across
  vec3 gridOffset;          // Must match the offset used when building the grid
} forceCollision;

#define pointsTextureSize forceCollision.pointsTextureSize
#define gridTextureSize forceCollision.gridTextureSize
#define cellSize forceCollision.cellSize
#define alpha forceCollision.alpha
#define collisionStrength forceCollision.collisionStrength
#define collisionRadius forceCollision.collisionRadius
#define collisionPadding forceCollision.collisionPadding
#define pointsNumber forceCollision.pointsNumber
#define tilesPerRow forceCollision.tilesPerRow
#define passesCount forceCollision.passesCount
#define gridOffset forceCollision.gridOffset
#else
uniform float pointsTextureSize;
uniform float gridTextureSize;
uniform float cellSize;
uniform float alpha;
uniform float collisionStrength;
uniform float collisionRadius;
uniform float collisionPadding;
uniform float pointsNumber;
uniform float tilesPerRow;
uniform float passesCount;
uniform vec3 gridOffset;
#endif

in vec2 textureCoords;
out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);

  // Get current point's index
  float currentIndex = pointPosition.b;

  // Skip if this is an empty texel
  if (currentIndex < 0.0 || currentIndex >= pointsNumber) {
    fragColor = velocity;
    return;
  }

  // Get current point's size for collision radius
  vec4 currentSizeData = texture(sizeTexture, textureCoords);
  float currentSize = currentSizeData.r;
  float currentCollisionRadius = (collisionRadius > 0.0 ? collisionRadius : currentSize * 0.5) + collisionPadding;

  // Track total neighbor count for damping
  float totalNeighbors = 0.0;

#ifdef SPACE_3D
  // The position texture stores z in the alpha channel
  vec3 currentPos = vec3(pointPosition.rg, pointPosition.a);

  // Apply the same offset used when building the grid
  vec3 offsetPos = currentPos + gridOffset * cellSize;

  // Calculate which grid cell this point is in (with offset), clamped to match build-grid.vert
  int gridSize = int(gridTextureSize);
  int rowTiles = int(tilesPerRow);
  ivec3 myCell = clamp(ivec3(floor(offsetPos / cellSize)), ivec3(0), ivec3(gridSize - 1));

  // Check 3x3x3 neighborhood of cells
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      for (int dz = -1; dz <= 1; dz++) {
        ivec3 cell = myCell + ivec3(dx, dy, dz);

        // Skip cells outside grid bounds
        if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, ivec3(gridSize)))) continue;

        // Sample the grid cell (z-slices tiled into the 2D texture)
        ivec2 pixel = ivec2(
          (cell.z % rowTiles) * gridSize + cell.x,
          (cell.z / rowTiles) * gridSize + cell.y
        );
        vec4 cellData = texelFetch(gridTexture, pixel, 0);

        float cellCount = cellData.w;
        if (cellCount < 0.5) continue; // Empty cell

        // Scale force by number of points in cell
        // Subtract 1 if this is our own cell to avoid self-collision
        float effectiveCount = cellCount;
        if (dx == 0 && dy == 0 && dz == 0) {
          effectiveCount = max(0.0, cellCount - 1.0);
        }

        totalNeighbors += effectiveCount;

        // Get average position in this cell. The 3D grid payload has no room for
        // a size sum, so neighbor radii are approximated by this point's own
        // radius (exact when `collisionRadius` is set or sizes are uniform).
        vec3 avgPos = cellData.xyz / cellCount;
        float otherCollisionRadius = currentCollisionRadius;

        // Calculate combined collision radius
        float combinedRadius = currentCollisionRadius + otherCollisionRadius;

        // Calculate distance vector to average position (using original positions)
        vec3 distVector = currentPos - avgPos;
        float dist = length(distVector);

        // Check for collision
        if (dist < combinedRadius && dist > 0.001) {
          // Calculate overlap ratio (0 = just touching, 1 = fully overlapping)
          float overlapRatio = (combinedRadius - dist) / combinedRadius;

          // Soft collision curve: use square root for gentler force near edges
          float softOverlap = sqrt(overlapRatio) * combinedRadius * 0.5;

          // Direction to push apart (normalized)
          vec3 direction = distVector / dist;

          // Apply repulsion force with soft curve, split across the offset passes
          float force = alpha * collisionStrength * softOverlap * (1.0 / passesCount) * effectiveCount;

          // Clamp maximum force to prevent instability
          force = min(force, combinedRadius * 0.5);

          velocity.rgb += force * direction;
        } else if (dist <= 0.001 && effectiveCount > 0.0) {
          // Points at same position - push in a direction from the index
          // (golden-spiral point on the unit sphere, so coincident points scatter evenly)
          float angle = currentIndex * 0.618033988749895 * 6.283185307179586;
          float zDir = 2.0 * fract(currentIndex * 0.754877666246693) - 1.0;
          float ring = sqrt(max(0.0, 1.0 - zDir * zDir));
          vec3 direction = vec3(ring * cos(angle), ring * sin(angle), zDir);
          float force = min(alpha * collisionStrength * combinedRadius * 0.1, combinedRadius * 0.3);
          velocity.rgb += force * effectiveCount * direction;
        }
      }
    }
  }

  // Apply density-based damping: reduce force when surrounded by many neighbors.
  // 3D cells hold far more points than 2D ones (volume vs area), so the damping
  // is floored — otherwise a dense pile is suppressed so hard it can never
  // push itself apart (the per-pass correction cap below prevents oscillation).
  if (totalNeighbors > 2.0) {
    float damping = max(2.0 / totalNeighbors, 0.05);
    velocity.rgb *= damping;
  }

  // Cap the per-pass correction so overlaps resolve by relaxation instead of
  // overshooting in one frame.
  float maxCorrection = currentCollisionRadius * 0.25;
  float correction = length(velocity.rgb);
  if (correction > maxCorrection) {
    velocity.rgb *= maxCorrection / correction;
  }

  // z velocity lives in the blue channel (update-position.frag SPACE_3D contract)
#else
  vec2 currentPos = pointPosition.rg;

  // Apply the same offset used when building the grid
  vec2 offsetPos = currentPos + gridOffset.xy * cellSize;

  // Calculate which grid cell this point is in (with offset).
  // Clamp to the grid bounds to match build-grid.vert, so a point that drifts
  // outside the space still reads the edge cell it was binned into.
  float myCellX = clamp(floor(offsetPos.x / cellSize), 0.0, gridTextureSize - 1.0);
  float myCellY = clamp(floor(offsetPos.y / cellSize), 0.0, gridTextureSize - 1.0);

  // Check 3x3 neighborhood of cells
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      float neighborCellX = myCellX + float(dx);
      float neighborCellY = myCellY + float(dy);

      // Skip cells outside grid bounds
      if (neighborCellX < 0.0 || neighborCellX >= gridTextureSize ||
          neighborCellY < 0.0 || neighborCellY >= gridTextureSize) {
        continue;
      }

      // Sample the grid cell
      vec2 gridCoord = (vec2(neighborCellX, neighborCellY) + 0.5) / gridTextureSize;
      vec4 cellData = texture(gridTexture, gridCoord);

      float cellCount = cellData.w;
      if (cellCount < 0.5) continue; // Empty cell

      // Scale force by number of points in cell
      // Subtract 1 if this is our own cell to avoid self-collision
      float effectiveCount = cellCount;
      if (dx == 0 && dy == 0) {
        effectiveCount = max(0.0, cellCount - 1.0);
      }

      totalNeighbors += effectiveCount;

      // Get average position and size in this cell
      vec2 avgPos = cellData.xy / cellCount;
      float avgSize = cellData.z / cellCount;
      float otherCollisionRadius = (collisionRadius > 0.0 ? collisionRadius : avgSize * 0.5) + collisionPadding;

      // Calculate combined collision radius
      float combinedRadius = currentCollisionRadius + otherCollisionRadius;

      // Calculate distance vector to average position (using original positions)
      vec2 distVector = currentPos - avgPos;
      float dist = length(distVector);

      // Check for collision
      if (dist < combinedRadius && dist > 0.001) {
        // Calculate overlap ratio (0 = just touching, 1 = fully overlapping)
        float overlapRatio = (combinedRadius - dist) / combinedRadius;

        // Soft collision curve: use square root for gentler force near edges
        // This prevents the "ping-pong" effect at boundaries
        float softOverlap = sqrt(overlapRatio) * combinedRadius * 0.5;

        // Direction to push apart (normalized)
        vec2 direction = distVector / dist;

        // Apply repulsion force with soft curve, split across the offset passes
        float force = alpha * collisionStrength * softOverlap * (1.0 / passesCount) * effectiveCount;

        // Clamp maximum force to prevent instability
        force = min(force, combinedRadius * 0.5);

        velocity.rg += force * direction;
      } else if (dist <= 0.001 && effectiveCount > 0.0) {
        // Points at same position - push based on index
        float angle = currentIndex * 0.618033988749895;
        float force = min(alpha * collisionStrength * combinedRadius * 0.1, combinedRadius * 0.3);
        velocity.rg += force * effectiveCount * vec2(cos(angle), sin(angle));
      }
    }
  }

  // Apply density-based damping: reduce force when surrounded by many neighbors.
  // This prevents chaotic oscillations in dense clusters. Floored (like the 3D
  // branch) so a dense pile is never suppressed so hard it can't push itself
  // apart — the per-pass correction cap below prevents oscillation.
  if (totalNeighbors > 2.0) {
    float damping = max(2.0 / totalNeighbors, 0.05);
    velocity.rg *= damping;
  }

  // Cap the per-pass correction so overlaps resolve by relaxation instead of
  // overshooting in one frame. Across the offset passes the total displacement
  // stays within ~one collision radius per tick, so a full overlap resolves in
  // a frame or two while the soft force curve keeps light contacts gentle.
  float maxCorrection = currentCollisionRadius * 0.25;
  float correction = length(velocity.rg);
  if (correction > maxCorrection) {
    velocity.rg *= maxCorrection / correction;
  }
#endif

  fragColor = velocity;
}
