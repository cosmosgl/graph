export function forceFrag (maxLinks: number): string {
  return `#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D exitTexture;
uniform sampler2D linkInfoTexture; // Texture storing first link indices and amount
uniform sampler2D linkIndicesTexture;
uniform sampler2D linkPropertiesTexture; // Texture storing link bias and strength
uniform sampler2D linkRandomDistanceTexture;
// Resolved point sizes (r channel), laid out like the positions texture. Only
// read while useCollisionRadii is set; otherwise a placeholder is bound.
uniform sampler2D sizeTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceLinkUniforms {
  float linkSpring;
  float linkDistance;
  vec2 linkDistRandomVariationRange;
  float linksTextureSize;
  float alpha;
  float collisionRadius;   // > 0: one fixed radius for every point; 0: size / 2
  float collisionPadding;
  float useCollisionRadii; // 1 while collision is on: rest length >= contact distance
} forceLink;

#define linkSpring forceLink.linkSpring
#define linkDistance forceLink.linkDistance
#define linkDistRandomVariationRange forceLink.linkDistRandomVariationRange
#define linksTextureSize forceLink.linksTextureSize
#define alpha forceLink.alpha
#define collisionRadius forceLink.collisionRadius
#define collisionPadding forceLink.collisionPadding
#define useCollisionRadii forceLink.useCollisionRadii
#else
uniform float linkSpring;
uniform float linkDistance;
uniform vec2 linkDistRandomVariationRange;
uniform float linksTextureSize;
uniform float alpha;
uniform float collisionRadius;
uniform float collisionPadding;
uniform float useCollisionRadii;
#endif

out vec4 fragColor;

const float MAX_LINKS = ${maxLinks}.0;

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec4 velocity = vec4(0.0);

  // This point's collision radius, for the rest-length floor below.
  float selfRadius = 0.0;
  if (useCollisionRadii > 0.5) {
    float selfSize = texelFetch(sizeTexture, pointTexel, 0).r;
    selfRadius = (collisionRadius > 0.0 ? collisionRadius : selfSize * 0.5) + collisionPadding;
  }

  vec4 linkInfo = texelFetch(linkInfoTexture, pointTexel, 0);
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
        ivec2 linkTexel = ivec2(iCount, jCount);
        vec4 connectedPointIndex = texelFetch(linkIndicesTexture, linkTexel, 0);
        vec4 biasAndStrength = texelFetch(linkPropertiesTexture, linkTexel, 0);
        vec4 randomMinDistance = texelFetch(linkRandomDistanceTexture, linkTexel, 0);
        float bias = biasAndStrength.r;
        float strength = biasAndStrength.g;
        float randomMinLinkDist = randomMinDistance.r * (linkDistRandomVariationRange.g - linkDistRandomVariationRange.r) + linkDistRandomVariationRange.r;
        randomMinLinkDist *= linkDistance;

        iCount += 1.0;

        // linkIndicesTexture stores whole texel coordinates, so truncating is exact.
        ivec2 connectedTexel = ivec2(connectedPointIndex.rg);

        // Skip a link to an absent point — its position would poison the spring
        // force. (exit.G = current absence)
        vec4 connectedExit = texelFetch(exitTexture, connectedTexel, 0);
        if (connectedExit.g > 0.5) {
          continue;
        }

        // While collision is on, a spring must never ask for less than the
        // contact distance: a rest length inside the two radii pulls the pair
        // into overlap every tick, and the two forces settle wherever they
        // balance — a guaranteed partial overlap. Lifting the rest length to the
        // contact distance removes the fight instead of relying on collision to
        // win it; collision then only cleans up transients.
        if (useCollisionRadii > 0.5) {
          float otherSize = texelFetch(sizeTexture, connectedTexel, 0).r;
          float otherRadius = (collisionRadius > 0.0 ? collisionRadius : otherSize * 0.5) + collisionPadding;
          randomMinLinkDist = max(randomMinLinkDist, selfRadius + otherRadius);
        }

        vec4 connectedPointPosition = texelFetch(positionsTexture, connectedTexel, 0);
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
