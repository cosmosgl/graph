#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D gridTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCollisionUniforms {
  float pointsTextureSize;
  float gridTextureSize;
  float cellSize;
  float spaceSize;
  float alpha;
  float collisionStrength;
  float collisionRadius;
  float collisionPadding;
  float pointsNumber;
  vec2 gridOffset; // Must match the offset used when building the grid
} forceCollision;

#define pointsTextureSize forceCollision.pointsTextureSize
#define gridTextureSize forceCollision.gridTextureSize
#define cellSize forceCollision.cellSize
#define spaceSize forceCollision.spaceSize
#define alpha forceCollision.alpha
#define collisionStrength forceCollision.collisionStrength
#define collisionRadius forceCollision.collisionRadius
#define collisionPadding forceCollision.collisionPadding
#define pointsNumber forceCollision.pointsNumber
#define gridOffset forceCollision.gridOffset
#else
uniform float pointsTextureSize;
uniform float gridTextureSize;
uniform float cellSize;
uniform float spaceSize;
uniform float alpha;
uniform float collisionStrength;
uniform float collisionRadius;
uniform float collisionPadding;
uniform float pointsNumber;
uniform vec2 gridOffset;
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

  vec2 currentPos = pointPosition.rg;

  // Apply the same offset used when building the grid
  vec2 offsetPos = currentPos + gridOffset * cellSize;

  // Calculate which grid cell this point is in (with offset).
  // Clamp to the grid bounds to match build-grid.vert, so a point that drifts
  // outside the space still reads the edge cell it was binned into.
  float myCellX = clamp(floor(offsetPos.x / cellSize), 0.0, gridTextureSize - 1.0);
  float myCellY = clamp(floor(offsetPos.y / cellSize), 0.0, gridTextureSize - 1.0);

  // Track total neighbor count for damping
  float totalNeighbors = 0.0;

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

        // Apply repulsion force with soft curve
        // Divide by 4 since we run 4 passes with different offsets
        float force = alpha * collisionStrength * softOverlap * 0.25 * effectiveCount;

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

  // Apply density-based damping: reduce force when surrounded by many neighbors
  // This prevents chaotic oscillations in dense clusters
  if (totalNeighbors > 2.0) {
    float damping = 2.0 / totalNeighbors;
    velocity.rg *= damping;
  }

  // Cap the per-pass correction so overlaps resolve by relaxation over a few
  // frames instead of overshooting in one. Across the 4 offset passes the
  // total displacement stays within ~40% of this point's collision radius,
  // which converges without the ping-pong of full-overlap corrections.
  float maxCorrection = currentCollisionRadius * 0.1;
  float correction = length(velocity.rg);
  if (correction > maxCorrection) {
    velocity.rg *= maxCorrection / correction;
  }

  fragColor = velocity;
}
