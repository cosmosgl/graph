export function forceFrag (maxLinks: number, umap?: { scale: number; a: number; b: number }): string {
  return `#version 300 es
precision highp float;

${umap === undefined
    ? ''
    : `
// UMAP attractive kernel constants. a, b are fit from min_dist / spread
// (see Shared/umap-params.ts); UMAP_SCALE converts space units to embedding units.
#define UMAP_KERNEL
const float UMAP_A = ${umap.a.toFixed(6)};
const float UMAP_B = ${umap.b.toFixed(6)};
const float UMAP_SCALE = ${umap.scale.toFixed(4)};
`}

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
} forceLink;

#define linkSpring forceLink.linkSpring
#define linkDistance forceLink.linkDistance
#define linkDistRandomVariationRange forceLink.linkDistRandomVariationRange
#define pointsTextureSize forceLink.pointsTextureSize
#define linksTextureSize forceLink.linksTextureSize
#define alpha forceLink.alpha
#else
uniform float linkSpring;
uniform float linkDistance;
uniform vec2 linkDistRandomVariationRange;
uniform float pointsTextureSize;
uniform float linksTextureSize;
uniform float alpha;
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

        #ifdef UMAP_KERNEL
        // UMAP attractive gradient along the kNN affinity edge, in embedding units:
        // 2ab·d²⁽ᵇ⁻¹⁾ / (1 + a·d²ᵇ) · w, per-component clipped to ±4 like the
        // reference SGD implementation. The degree bias is skipped: the fuzzy
        // weights are symmetric and both endpoints receive the full gradient.
        float d2 = (l * l) / (UMAP_SCALE * UMAP_SCALE);
        float w = strength * strength; // undo the sqrt applied on ingest
        float coeff = 0.0;
        if (d2 > 0.0) {
          coeff = 2.0 * UMAP_A * UMAP_B * pow(d2, UMAP_B - 1.0) / (1.0 + UMAP_A * pow(d2, UMAP_B));
        }
        float k = linkSpring * alpha * w * UMAP_SCALE;
        velocity.x += clamp(coeff * x / UMAP_SCALE, -4.0, 4.0) * k;
        velocity.y += clamp(coeff * y / UMAP_SCALE, -4.0, 4.0) * k;
        #ifdef SPACE_3D
        velocity.b += clamp(coeff * z / UMAP_SCALE, -4.0, 4.0) * k;
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
