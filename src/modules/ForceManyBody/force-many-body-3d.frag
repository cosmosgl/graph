#version 300 es
precision highp float;

// Exact O(n²) 3D repulsion, used for graphs up to BRUTE_FORCE_3D_MAX_POINTS points
// (larger 3D graphs use the octree passes in calculate-level-3d / force-level-3d /
// force-centermass-3d). It matches the 2D force semantics (d3-style clamped
// inverse-distance falloff) with per-point mass 1.

uniform sampler2D positionsTexture;
uniform sampler2D randomValues;
#ifdef TSNE_KERNEL
// 1×1 texture holding last tick's global normalization Z (see reduce-sum.frag).
uniform sampler2D zTexture;
#endif

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceBruteForceUniforms {
  float pointsTextureSize;
  float pointsNumber;
  float alpha;
  float repulsion;
  // UMAP repulsive kernel parameters (live-updatable); unused in the default kernel.
  float umapA;
  float umapB;
  float umapScale;
} forceBruteForce;

#define pointsTextureSize forceBruteForce.pointsTextureSize
#define pointsNumber forceBruteForce.pointsNumber
#define alpha forceBruteForce.alpha
#define repulsion forceBruteForce.repulsion
#define umapA forceBruteForce.umapA
#define umapB forceBruteForce.umapB
#define umapScale forceBruteForce.umapScale
#else
uniform float pointsTextureSize;
uniform float pointsNumber;
uniform float alpha;
uniform float repulsion;
uniform float umapA;
uniform float umapB;
uniform float umapScale;
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
  #ifdef TSNE_KERNEL
  // Partial sum for the global Z (written to the alpha channel below).
  float zAccum = 0.0;
  float Z = max(texelFetch(zTexture, ivec2(0), 0).r, 1e-6);
  #endif

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

      #ifdef TSNE_KERNEL
      // t-SNE repulsive gradient (see force-level.frag), per-pair with mass 1.
      float d2 = l / (umapScale * umapScale);
      float w = 1.0 / (1.0 + d2);
      zAccum += w;
      velocity += alpha * repulsion * (4.0 * w * w / Z) * distVector;
      #elif defined(UMAP_KERNEL)
      // UMAP repulsive gradient (see force-level.frag), per-pair with mass 1.
      float d2 = l / (umapScale * umapScale);
      float coeff = 2.0 * umapB / ((0.001 + d2) * (1.0 + umapA * pow(d2, umapB)));
      velocity += alpha * repulsion * umapScale * clamp(coeff * distVector / umapScale, -4.0, 4.0);
      #else
      // Mirrors the 2D level force: c / dist with a minimum-distance clamp.
      float distanceMin2 = 1.0;
      if (l < distanceMin2) l = sqrt(distanceMin2 * l);
      float addV = alpha * repulsion / sqrt(l);
      velocity += addV * normalize(distVector);
      #endif
    }
  }

  #if !defined(UMAP_KERNEL) && !defined(TSNE_KERNEL)
  // Random jitter proportional to the velocity, like the 2D centermass force.
  // Skipped for the embedding kernels: an embedding should settle, not boil.
  velocity += velocity * random.rgb;
  #endif

  #ifdef TSNE_KERNEL
  fragColor = vec4(velocity, zAccum);
  #else
  fragColor = vec4(velocity, 0.0);
  #endif
}
