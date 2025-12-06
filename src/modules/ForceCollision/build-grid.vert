#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform float pointsTextureSize;
uniform float gridTextureSize;
uniform float cellSize;
uniform vec2 gridOffset; // Offset for multi-pass (0-1 range, will be multiplied by cellSize)

attribute vec2 pointIndices;

varying vec4 cellData; // xy = position, z = size, w = count (1.0)

void main() {
  vec4 pointPosition = texture2D(positionsTexture, pointIndices / pointsTextureSize);
  vec4 pointSize = texture2D(sizeTexture, pointIndices / pointsTextureSize);
  
  // Output: position sum, size sum, count
  cellData = vec4(pointPosition.xy, pointSize.r, 1.0);

  // Apply grid offset for multi-pass collision detection
  vec2 offsetPosition = pointPosition.xy + gridOffset * cellSize;

  // Calculate which grid cell this point belongs to
  float cellX = floor(offsetPosition.x / cellSize);
  float cellY = floor(offsetPosition.y / cellSize);
  
  // Clamp to grid bounds
  cellX = clamp(cellX, 0.0, gridTextureSize - 1.0);
  cellY = clamp(cellY, 0.0, gridTextureSize - 1.0);
  
  // Convert to clip space coordinates
  vec2 gridPosition = 2.0 * (vec2(cellX, cellY) + 0.5) / gridTextureSize - 1.0;

  gl_Position = vec4(gridPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}

