export function forceFrag (maxLinks: number): string {
  return `#version 300 es
precision highp float;

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
        float l = sqrt(x * x + y * y);

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
      }
    }
  }

  fragColor = vec4(velocity.rg, 0.0, 0.0);
}
  `
}
