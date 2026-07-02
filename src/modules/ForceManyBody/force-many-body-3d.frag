#version 300 es
precision highp float;

// Exact O(n²) 3D repulsion. The 2D force uses a quadtree approximation
// (calculate-level / force-level), which does not port to 3D without an octree —
// this brute-force pass is used in 3D mode instead. It matches the 2D force
// semantics (d3-style clamped inverse-distance falloff) with per-point mass 1,
// and is practical up to roughly 10–20k points on discrete GPUs.

uniform sampler2D positionsTexture;
uniform sampler2D randomValues;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceBruteForceUniforms {
  float pointsTextureSize;
  float pointsNumber;
  float alpha;
  float repulsion;
} forceBruteForce;

#define pointsTextureSize forceBruteForce.pointsTextureSize
#define pointsNumber forceBruteForce.pointsNumber
#define alpha forceBruteForce.alpha
#define repulsion forceBruteForce.repulsion
#else
uniform float pointsTextureSize;
uniform float pointsNumber;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  // z lives in the position alpha channel
  vec3 position = vec3(pointPosition.rg, pointPosition.a);
  vec4 random = texture(randomValues, textureCoords);

  vec3 velocity = vec3(0.0);
  int size = int(pointsTextureSize);
  int count = int(pointsNumber);
  ivec2 selfPixel = ivec2(gl_FragCoord.xy);
  int pointIndex = 0;

  for (int j = 0; j < size; j += 1) {
    if (pointIndex >= count) break;
    for (int i = 0; i < size; i += 1) {
      if (pointIndex >= count) break;
      pointIndex += 1;
      if (i == selfPixel.x && j == selfPixel.y) continue;

      vec4 otherPosition = texelFetch(positionsTexture, ivec2(i, j), 0);
      vec3 distVector = position - vec3(otherPosition.rg, otherPosition.a);
      float l = dot(distVector, distVector);
      if (l == 0.0) {
        // Coincident points: kick in this point's own random direction so pairs
        // can separate (each point has a different random value).
        distVector = random.rgb;
        l = dot(distVector, distVector);
        if (l == 0.0) continue;
      }

      // Mirrors the 2D level force: c / dist with a minimum-distance clamp.
      float distanceMin2 = 1.0;
      if (l < distanceMin2) l = sqrt(distanceMin2 * l);
      float addV = alpha * repulsion / sqrt(l);
      velocity += addV * normalize(distVector);
    }
  }

  // Random jitter proportional to the velocity, like the 2D centermass force.
  velocity += velocity * random.rgb;

  fragColor = vec4(velocity, 0.0);
}
