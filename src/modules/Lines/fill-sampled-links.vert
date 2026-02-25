#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 pointA;
in vec2 pointB;
in float linkIndices;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform fillSampledLinksUniforms {
  float pointsTextureSize;
  mat4 transformationMatrix;
  float spaceSize;
  vec2 screenSize;
  float curvedWeight;
  float curvedLinkControlPointDistance;
  float curvedLinkSegments;
} fillSampledLinks;

#define pointsTextureSize fillSampledLinks.pointsTextureSize
#define transformationMatrix fillSampledLinks.transformationMatrix
#define spaceSize fillSampledLinks.spaceSize
#define screenSize fillSampledLinks.screenSize
#define curvedWeight fillSampledLinks.curvedWeight
#define curvedLinkControlPointDistance fillSampledLinks.curvedLinkControlPointDistance
#define curvedLinkSegments fillSampledLinks.curvedLinkSegments
#else
uniform float pointsTextureSize;
uniform float spaceSize;
uniform vec2 screenSize;
uniform float curvedWeight;
uniform float curvedLinkControlPointDistance;
uniform float curvedLinkSegments;
uniform mat3 transformationMatrix;
#endif

out vec4 rgba;

void main() {
  vec4 posA = texture(positionsTexture, (pointA + 0.5) / pointsTextureSize);
  vec4 posB = texture(positionsTexture, (pointB + 0.5) / pointsTextureSize);
  vec2 a = posA.rg;
  vec2 b = posB.rg;

  vec2 tangent = b - a;
  float angle = -atan(tangent.y, tangent.x);

  vec2 mid;
  if (curvedLinkSegments <= 1.0) {
    mid = (a + b) * 0.5;
  } else if (curvedLinkControlPointDistance != 0.0 && curvedWeight != 0.0) {
    vec2 xBasis = b - a;
    vec2 yBasis = normalize(vec2(-xBasis.y, xBasis.x));
    float linkDist = length(xBasis);
    float h = curvedLinkControlPointDistance;
    vec2 controlPoint = (a + b) / 2.0 + yBasis * linkDist * h;
    mid = conicParametricCurve(a, b, controlPoint, 0.5, curvedWeight);
  } else {
    mid = (a + b) * 0.5;
  }

  vec2 p = 2.0 * mid / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  #ifdef USE_UNIFORM_BUFFERS
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif

  vec2 pointScreenPosition = (final.xy + 1.0) * screenSize / 2.0;
  rgba = vec4(linkIndices, mid.x, mid.y, angle);
  float i = (pointScreenPosition.x + 0.5) / screenSize.x;
  float j = (pointScreenPosition.y + 0.5) / screenSize.y;
  gl_Position = vec4(2.0 * vec2(i, j) - 1.0, 0.0, 1.0);

  gl_PointSize = 1.0;
}
