#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D gridTexture;
uniform float pointsTextureSize;
uniform float gridTextureSize;
uniform float cellSize;
uniform float spaceSize;
uniform float alpha;
uniform float collisionStrength;
uniform float collisionRadius;
uniform int pointsNumber;
uniform vec2 gridOffset; // Must match the offset used when building the grid

varying vec2 textureCoords;

void main() {
  vec4 pointPosition = texture2D(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);

  // Get current point's index
  float currentIndex = pointPosition.b;

  // Skip if this is an empty texel
  if (currentIndex < 0.0 || currentIndex >= float(pointsNumber)) {
    gl_FragColor = velocity;
    return;
  }

  // Get current point's size for collision radius
  vec4 currentSizeData = texture2D(sizeTexture, textureCoords);
  float currentSize = currentSizeData.r;
  float currentCollisionRadius = collisionRadius > 0.0 ? collisionRadius : currentSize * 0.5;

  vec2 currentPos = pointPosition.rg;
  
  // Apply the same offset used when building the grid
  vec2 offsetPos = currentPos + gridOffset * cellSize;

  // Calculate which grid cell this point is in (with offset)
  float myCellX = floor(offsetPos.x / cellSize);
  float myCellY = floor(offsetPos.y / cellSize);

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
      vec4 cellData = texture2D(gridTexture, gridCoord);
      
      float cellCount = cellData.w;
      if (cellCount < 0.5) continue; // Empty cell
      
      // Get average position and size in this cell
      // Note: positions stored are original (not offset), so use them directly
      vec2 avgPos = cellData.xy / cellCount;
      float avgSize = cellData.z / cellCount;
      float otherCollisionRadius = collisionRadius > 0.0 ? collisionRadius : avgSize * 0.5;
      
      // Calculate combined collision radius
      float combinedRadius = currentCollisionRadius + otherCollisionRadius;
      
      // Calculate distance vector to average position (using original positions)
      vec2 distVector = currentPos - avgPos;
      float dist = length(distVector);
      
      // Check for collision
      if (dist < combinedRadius && dist > 0.001) {
        // Calculate overlap amount
        float overlap = combinedRadius - dist;
        
        // Direction to push apart (normalized)
        vec2 direction = distVector / dist;
        
        // Scale force by number of points in cell
        // Subtract 1 if this is our own cell to avoid self-collision
        float effectiveCount = cellCount;
        if (dx == 0 && dy == 0) {
          effectiveCount = max(0.0, cellCount - 1.0);
        }
        
        // Apply repulsion force proportional to overlap
        // Divide by 4 since we run 4 passes with different offsets
        float force = alpha * collisionStrength * overlap * 0.25 * effectiveCount;
        velocity.rg += force * direction;
      } else if (dist <= 0.001 && cellCount > 1.0) {
        // Points at same position - push based on index
        float angle = currentIndex * 0.618033988749895;
        float effectiveCount = (dx == 0 && dy == 0) ? max(0.0, cellCount - 1.0) : cellCount;
        velocity.rg += alpha * collisionStrength * combinedRadius * 0.25 * effectiveCount * vec2(cos(angle), sin(angle));
      }
    }
  }

  gl_FragColor = velocity;
}

