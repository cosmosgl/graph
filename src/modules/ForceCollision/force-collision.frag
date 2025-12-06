#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform float pointsTextureSize;
uniform float spaceSize;
uniform float alpha;
uniform float collisionStrength;
uniform float collisionRadius;
uniform int pointsNumber;

varying vec2 textureCoords;

void main() {
  vec4 pointPosition = texture2D(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);

  // Get current point's index
  float currentIndex = pointPosition.b;

  // Skip if this is an empty texel (index would be 0 for first point, but position would be valid)
  if (currentIndex < 0.0 || currentIndex >= float(pointsNumber)) {
    gl_FragColor = velocity;
    return;
  }

  // Get current point's size for collision radius
  vec4 currentSizeData = texture2D(sizeTexture, textureCoords);
  float currentSize = currentSizeData.r;
  float currentCollisionRadius = collisionRadius > 0.0 ? collisionRadius : currentSize * 0.5;

  vec2 currentPos = pointPosition.rg;

  // Iterate through all other points
  for (int i = 0; i < 16384; i++) { // Max iterations (128*128 texture)
    if (i >= pointsNumber) break;

    // Calculate texture coordinates for point i
    float fi = float(i);
    float tx = mod(fi, pointsTextureSize) / pointsTextureSize;
    float ty = floor(fi / pointsTextureSize) / pointsTextureSize;
    vec2 otherTexCoord = vec2(tx + 0.5 / pointsTextureSize, ty + 0.5 / pointsTextureSize);

    // Skip self
    if (abs(fi - currentIndex) < 0.5) continue;

    vec4 otherPosition = texture2D(positionsTexture, otherTexCoord);
    vec4 otherSizeData = texture2D(sizeTexture, otherTexCoord);
    float otherSize = otherSizeData.r;
    float otherCollisionRadius = collisionRadius > 0.0 ? collisionRadius : otherSize * 0.5;

    // Calculate combined collision radius
    float combinedRadius = currentCollisionRadius + otherCollisionRadius;

    // Calculate distance vector
    vec2 distVector = currentPos - otherPosition.rg;
    float dist = length(distVector);

    // Check for collision (when points are closer than combined radius)
    if (dist < combinedRadius && dist > 0.001) {
      // Calculate overlap amount
      float overlap = combinedRadius - dist;

      // Direction to push apart (normalized)
      vec2 direction = distVector / dist;

      // Apply repulsion force proportional to overlap
      float force = alpha * collisionStrength * overlap * 0.5;
      velocity.rg += force * direction;
    } else if (dist <= 0.001) {
      // Points are at same position - push in random direction based on index
      float angle = currentIndex * 0.618033988749895; // Golden ratio for pseudo-random distribution
      velocity.rg += alpha * collisionStrength * combinedRadius * 0.5 * vec2(cos(angle), sin(angle));
    }
  }

  gl_FragColor = velocity;
}



