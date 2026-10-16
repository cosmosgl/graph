#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D gridTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCollisionUniforms {
  float alpha;
  float collisionStrength;
  float collisionRadius;
  float collisionPadding;
  float pointsNumber;
  vec2 gridOffset; // Must match the offset used when building the grid
  float cellsPerUnit; // 1 / the hash's cell size, the same bits build-grid.vert gets
  float rotationSeed; // This tick's addition to the hash's block rotations, the same as build-grid.vert's
} forceCollision;

#define alpha forceCollision.alpha
#define collisionStrength forceCollision.collisionStrength
#define collisionRadius forceCollision.collisionRadius
#define collisionPadding forceCollision.collisionPadding
#define pointsNumber forceCollision.pointsNumber
#define gridOffset forceCollision.gridOffset
#define cellsPerUnit forceCollision.cellsPerUnit
#define rotationSeed forceCollision.rotationSeed
#else
uniform float alpha;
uniform float collisionStrength;
uniform float collisionRadius;
uniform float collisionPadding;
uniform float pointsNumber;
uniform vec2 gridOffset;
uniform float cellsPerUnit;
uniform float rotationSeed;
#endif

// @collision-grid

out vec4 fragColor;

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 velocity = vec4(0.0);

  // Get current point's index
  float currentIndex = pointPosition.b;

  // Skip if this is an empty texel
  if (currentIndex < 0.0 || currentIndex >= pointsNumber) {
    fragColor = velocity;
    return;
  }

  // Get current point's size for collision radius
  vec4 currentSizeData = texelFetch(sizeTexture, pointTexel, 0);
  float currentSize = currentSizeData.r;
  float currentCollisionRadius = (collisionRadius > 0.0 ? collisionRadius : currentSize * 0.5) + collisionPadding;

  // The grid holds positions relative to the data box's centre; compare in
  // the same frame (collision-grid.ts).
  vec2 currentPos = collisionLocal(pointPosition.rg);

  // The cell build-grid.vert binned this point into on this pass's grid — the
  // same bits, from the shared formula (collision-grid.ts), so the self-removal
  // below subtracts the point from the texel that actually holds it.
  highp ivec2 myCell = collisionCell(pointPosition.rg, gridOffset, cellsPerUnit);

  // Track total neighbor count for damping
  float totalNeighbors = 0.0;

  // Check 3x3 neighborhood of cells. The hash has no edge: each neighbour
  // hashes onto the grid like every binned cell (collision-grid.ts), so the
  // neighbour across a block boundary is wherever that block's cells went.
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      vec4 cellData = texelFetch(gridTexture, collisionTexel(myCell + ivec2(dx, dy), gridOffset, rotationSeed), 0);

      float cellCount = cellData.w;
      if (cellCount < 0.5) continue; // Empty cell

      // The own cell's sums include this point, which drags the average toward
      // it and halves the measured distance for a two-point cell. Remove the
      // self-contribution before averaging, and skip a cell holding only self.
      float effectiveCount = cellCount;
      vec2 sumPos = cellData.xy;
      float sumSize = cellData.z;
      if (dx == 0 && dy == 0) {
        effectiveCount = cellCount - 1.0;
        sumPos -= currentPos;
        sumSize -= currentSize;
      }
      if (effectiveCount < 0.5) continue;

      totalNeighbors += effectiveCount;

      // Average position and size of the *other* points in this cell
      vec2 avgPos = sumPos / effectiveCount;
      float avgSize = sumSize / effectiveCount;
      float otherCollisionRadius = (collisionRadius > 0.0 ? collisionRadius : avgSize * 0.5) + collisionPadding;

      // Calculate combined collision radius
      float combinedRadius = currentCollisionRadius + otherCollisionRadius;

      // Calculate distance vector to average position (using original positions)
      vec2 distVector = currentPos - avgPos;
      float dist = length(distVector);

      // Closer than the rounding error of that average, the direction to it is
      // noise, and points closer than this count as coincident. The texel's
      // sums are float32 additions: n points summed err by up to n − 1
      // roundings of the running total, so the average of the others is off
      // by up to about 2^-23 of the sum's magnitude — over 0.001 for a stack
      // of a few hundred points a thousand units from the data's centre, which
      // otherwise read their noise as one common direction and moved as a block.
      float coincidence = max(0.001, length(cellData.xy) * 1.1920929e-7);

      // Check for collision
      if (dist < combinedRadius && dist > coincidence) {
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
      } else if (dist <= coincidence && effectiveCount > 0.0) {
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
