#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D levelFbo;
#ifdef TSNE_KERNEL
// 1×1 texture holding last tick's global normalization Z (see reduce-sum.frag).
uniform sampler2D zTexture;
#endif

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceUniforms {
  float level;
  float levels;
  float levelTextureSize;
  float alpha;
  float repulsion;
  float spaceSize;
  float theta;
  // UMAP repulsive kernel parameters (uniforms so min_dist / spread / scale can
  // change live without a shader rebuild); unused in the default kernel.
  float umapA;
  float umapB;
  float umapScale;
} force;

#define level force.level
#define levels force.levels
#define levelTextureSize force.levelTextureSize
#define alpha force.alpha
#define repulsion force.repulsion
#define spaceSize force.spaceSize
#define theta force.theta
#define umapA force.umapA
#define umapB force.umapB
#define umapScale force.umapScale
#else
uniform float level;
uniform float levels;
uniform float levelTextureSize;
uniform float repulsion;
uniform float alpha;
uniform float spaceSize;
uniform float theta;
uniform float umapA;
uniform float umapB;
uniform float umapScale;
#endif

in vec2 textureCoords;
out vec4 fragColor;

const float MAX_LEVELS_NUM = 14.0;

#ifdef TSNE_KERNEL
// Per-point partial sum Sᵢ = Σ mass·w for the global Z; accumulated across the
// cell loop and written to the alpha channel (additively blended across passes).
float zAccum = 0.0;
#endif

vec2 calculateAdditionalVelocity (vec2 ij, vec2 pp) {
  vec2 add = vec2(0.0);
  vec4 centermass = texture(levelFbo, ij);
  if (centermass.r > 0.0 && centermass.g > 0.0 && centermass.b > 0.0) {
    vec2 centermassPosition = vec2(centermass.rg / centermass.b);
    vec2 distVector = pp - centermassPosition;
    float l = dot(distVector, distVector);
    float dist = sqrt(l);
    if (l > 0.0) {
      #ifdef TSNE_KERNEL
      // Barnes-Hut t-SNE repulsive gradient: 4·mass·w²/Z away from the cell's
      // center of mass, w = 1/(1 + d²) in embedding units. Z is last tick's
      // global sum (one-tick lag); the embedding scale cancels except inside w.
      float d2 = l / (umapScale * umapScale);
      float w = 1.0 / (1.0 + d2);
      float Z = max(texelFetch(zTexture, ivec2(0), 0).r, 1e-6);
      zAccum += centermass.b * w;
      add = alpha * repulsion * centermass.b * (4.0 * w * w / Z) * distVector;
      #elif defined(UMAP_KERNEL)
      // UMAP repulsive gradient: 2b / ((0.001 + d²)(1 + a·d²ᵇ)) per unit mass, in
      // embedding units (umapScale space units = 1 embedding unit), per-component
      // clipped to ±4 like the reference SGD implementation.
      float d2 = l / (umapScale * umapScale);
      float coeff = 2.0 * umapB / ((0.001 + d2) * (1.0 + umapA * pow(d2, umapB)));
      add = alpha * repulsion * centermass.b * umapScale * clamp(coeff * distVector / umapScale, -4.0, 4.0);
      #else
      float c = alpha * repulsion * centermass.b;

      float distanceMin2 = 1.0;
      if (l < distanceMin2) l = sqrt(distanceMin2 * l);
      float addV = c / sqrt(l);
      add = addV * normalize(distVector);
      #endif
    }
  }
  return add;
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  float x = pointPosition.x;
  float y = pointPosition.y;

  float left = 0.0;
  float top = 0.0;
  float right = spaceSize;
  float bottom = spaceSize;

  float n_left = 0.0;
  float n_top = 0.0;
  float n_right = 0.0;
  float n_bottom = 0.0;

  float cellSize = 0.0;

  // Iterate over levels to adjust the boundaries based on the current level
  for (float i = 0.0; i < MAX_LEVELS_NUM; i += 1.0) {
    if (i <= level) {
      left += cellSize * n_left;
      top += cellSize * n_top;
      right -= cellSize * n_right;
      bottom -= cellSize * n_bottom;

      cellSize = pow(2.0 , levels - i - 1.0);

      float dist_left = x - left;
      n_left = max(0.0, floor(dist_left / cellSize - theta));

      float dist_top = y - top;
      n_top = max(0.0, floor(dist_top / cellSize - theta));
      
      float dist_right = right - x;
      n_right = max(0.0, floor(dist_right / cellSize - theta));

      float dist_bottom = bottom - y;
      n_bottom = max(0.0, floor(dist_bottom / cellSize - theta));

    }
  }

  vec4 velocity = vec4(vec2(0.0), 1.0, 0.0);

  // Calculate the additional velocity based on neighboring cells
  for (float i = 0.0; i < 12.0; i += 1.0) {
    for (float j = 0.0; j < 4.0; j += 1.0) {
      float n = left + cellSize * j;
      float m = top + cellSize * n_top + cellSize * i;

      if (n < (left + n_left * cellSize) && m < bottom) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }

      n = left + cellSize * i;
      m = top + cellSize * j;

      if (n < (right - n_right * cellSize) && m < (top + n_top * cellSize)) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }

      n = right - n_right * cellSize + cellSize * j;
      m = top + cellSize * i;

      if (n < right && m < (bottom - n_bottom * cellSize)) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }

      n = left + n_left * cellSize + cellSize * i;
      m = bottom - n_bottom * cellSize + cellSize * j;

      if (n < right && m < bottom) {
        velocity.xy += calculateAdditionalVelocity(vec2(n / cellSize, m / cellSize) / levelTextureSize, pointPosition.xy);
      }
    }
  }

  #ifdef TSNE_KERNEL
  velocity.a = zAccum;
  #endif
  fragColor = velocity;
}