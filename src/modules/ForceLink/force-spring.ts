export function forceFrag (maxLinks: number, kernel: 'default' | 'umap' | 'tsne' = 'default'): string {
  return `#version 300 es
precision highp float;

${kernel === 'umap' ? '#define UMAP_KERNEL' : ''}
${kernel === 'tsne' ? '#define TSNE_KERNEL' : ''}

uniform sampler2D positionsTexture;
uniform sampler2D linkInfoTexture; // Texture storing first link indices and amount
uniform sampler2D linkIndicesTexture;
uniform sampler2D linkPropertiesTexture; // Texture storing link bias and strength
uniform sampler2D linkRandomDistanceTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceLinkUniforms {
  float linkSpring;
  float linkDistance;
  vec2 linkDistRandomVariationRange;
  float pointsTextureSize;
  float linksTextureSize;
  float alpha;
  // UMAP attractive kernel parameters (uniforms so min_dist / spread / scale can
  // change live without a shader rebuild). a, b are fit from min_dist / spread
  // (see Shared/umap-params.ts); umapScale converts space units to embedding units.
  float umapA;
  float umapB;
  float umapScale;
  float pointsNumber;
} forceLink;

#define linkSpring forceLink.linkSpring
#define linkDistance forceLink.linkDistance
#define linkDistRandomVariationRange forceLink.linkDistRandomVariationRange
#define pointsTextureSize forceLink.pointsTextureSize
#define linksTextureSize forceLink.linksTextureSize
#define alpha forceLink.alpha
#define umapA forceLink.umapA
#define umapB forceLink.umapB
#define umapScale forceLink.umapScale
#define pointsNumber forceLink.pointsNumber
#else
uniform float linkSpring;
uniform float linkDistance;
uniform vec2 linkDistRandomVariationRange;
uniform float pointsTextureSize;
uniform float linksTextureSize;
uniform float alpha;
uniform float umapA;
uniform float umapB;
uniform float umapScale;
uniform float pointsNumber;
#endif

in vec2 textureCoords;
out vec4 fragColor;

const float MAX_LINKS = ${maxLinks}.0;

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec4 velocity = vec4(0.0);

  vec4 linkInfo = texture(linkInfoTexture, textureCoords);
  float iCount = linkInfo.r;
  float jCount = linkInfo.g;
  float linkAmount = linkInfo.b;
  if (linkAmount > 0.0) {
    for (float i = 0.0; i < MAX_LINKS; i += 1.0) {
      if (i < linkAmount) {
        if (iCount >= linksTextureSize) {
          iCount = 0.0;
          jCount += 1.0;
        }
        vec2 linkTextureIndex = (vec2(iCount, jCount) + 0.5) / linksTextureSize;
        vec4 connectedPointIndex = texture(linkIndicesTexture, linkTextureIndex);
        vec4 biasAndStrength = texture(linkPropertiesTexture, linkTextureIndex);
        vec4 randomMinDistance = texture(linkRandomDistanceTexture, linkTextureIndex);
        float bias = biasAndStrength.r;
        float strength = biasAndStrength.g;
        float randomMinLinkDist = randomMinDistance.r * (linkDistRandomVariationRange.g - linkDistRandomVariationRange.r) + linkDistRandomVariationRange.r;
        randomMinLinkDist *= linkDistance;

        iCount += 1.0;

        vec4 connectedPointPosition = texture(positionsTexture, (connectedPointIndex.rg + 0.5) / pointsTextureSize);
        float x = connectedPointPosition.x - (pointPosition.x + velocity.x);
        float y = connectedPointPosition.y - (pointPosition.y + velocity.y);
        #ifdef SPACE_3D
        // z lives in the position alpha channel; z velocity accumulates in the blue channel.
        float z = connectedPointPosition.a - (pointPosition.a + velocity.b);
        float l = sqrt(x * x + y * y + z * z);
        #else
        float l = sqrt(x * x + y * y);
        #endif

        #ifdef TSNE_KERNEL
        // Barnes-Hut t-SNE attractive gradient along the kNN edge:
        // 4·p_ij·w·(y_j − y_i) with w = 1/(1 + d²) (Student-t numerator).
        // Scaled by pointsNumber as a learning-rate normalization (p_ij sums to 1
        // over the whole graph, so raw gradients are O(1/n)). The embedding scale
        // cancels out except inside w. linkSpring doubles as the (early)
        // exaggeration knob. The degree bias is skipped: p_ij is symmetric.
        float d2 = (l * l) / (umapScale * umapScale);
        float p = strength * strength; // undo the sqrt applied on ingest
        float w = 1.0 / (1.0 + d2);
        float k = 4.0 * pointsNumber * p * w * linkSpring * alpha;
        velocity.x += k * x;
        velocity.y += k * y;
        #ifdef SPACE_3D
        velocity.b += k * z;
        #endif
        #elif defined(UMAP_KERNEL)
        // UMAP attractive gradient along the kNN affinity edge, in embedding units:
        // 2ab·d²⁽ᵇ⁻¹⁾ / (1 + a·d²ᵇ) · w, per-component clipped to ±4 like the
        // reference SGD implementation. The degree bias is skipped: the fuzzy
        // weights are symmetric and both endpoints receive the full gradient.
        float d2 = (l * l) / (umapScale * umapScale);
        float w = strength * strength; // undo the sqrt applied on ingest
        float coeff = 0.0;
        if (d2 > 0.0) {
          coeff = 2.0 * umapA * umapB * pow(d2, umapB - 1.0) / (1.0 + umapA * pow(d2, umapB));
        }
        float k = linkSpring * alpha * w * umapScale;
        velocity.x += clamp(coeff * x / umapScale, -4.0, 4.0) * k;
        velocity.y += clamp(coeff * y / umapScale, -4.0, 4.0) * k;
        #ifdef SPACE_3D
        velocity.b += clamp(coeff * z / umapScale, -4.0, 4.0) * k;
        #endif
        #else
        // Apply the link force
        l = max(l, randomMinLinkDist * 0.99);
        l = (l - randomMinLinkDist) / l;
        l *= linkSpring * alpha;
        l *= strength;
        l *= bias;
        x *= l;
        y *= l;
        velocity.x += x;
        velocity.y += y;
        #ifdef SPACE_3D
        z *= l;
        velocity.b += z;
        #endif
        #endif
      }
    }
  }

  fragColor = vec4(velocity.rg, velocity.b, 0.0);
}
  `
}
