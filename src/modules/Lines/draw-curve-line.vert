precision highp float;

attribute vec2 position, pointA, pointB;
attribute vec4 color;
attribute float width;
attribute float arrow;
attribute float linkIndices;

uniform sampler2D positionsTexture;
uniform sampler2D pointGreyoutStatus;
uniform mat3 transformationMatrix;
uniform float pointsTextureSize;
uniform float widthScale;
uniform float arrowSizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform vec2 linkVisibilityDistanceRange;
uniform float linkVisibilityMinTransparency;
uniform float linkOpacity;
uniform float greyoutOpacity;
uniform float curvedWeight;
uniform float curvedLinkControlPointDistance;
uniform float curvedLinkSegments;
uniform bool scaleLinksOnZoom;
uniform float maxPointSize;
// renderMode: 0.0 = normal rendering, 1.0 = index buffer rendering for picking
uniform float renderMode;
uniform float hoveredLinkIndex;

varying vec4 rgbaColor;
varying vec2 pos;
varying float arrowLength;
varying float useArrow;
varying float smoothing;
varying float arrowWidthFactor;
varying float linkIndex;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

vec2 conicParametricCurve(vec2 A, vec2 B, vec2 ControlPoint, float t, float w) {
  vec2 divident = (1.0 - t) * (1.0 - t) * A + 2.0 * (1.0 - t) * t * w * ControlPoint + t * t * B;
  float divisor = (1.0 - t) * (1.0 - t) + 2.0 * (1.0 - t) * t * w + t * t;
  return divident / divisor;
}

float calculateLinkWidth(float width) {
  float linkWidth;
  if (scaleLinksOnZoom) {
    // Use original width if links should scale with zoom
    linkWidth = width;
  } else {
    // Adjust width based on zoom level to maintain visual size
    linkWidth = width / transformationMatrix[0][0];
    // Apply a non-linear scaling to avoid extreme widths
    linkWidth *= min(5.0, max(1.0, transformationMatrix[0][0] * 0.01));
  }
  // Limit link width based on whether it has an arrow
  if (useArrow > 0.5) {
    return min(linkWidth, (maxPointSize * 2.0) / transformationMatrix[0][0]);
  } else {
    return min(linkWidth, maxPointSize / transformationMatrix[0][0]);
  }
}

float calculateArrowWidth(float arrowWidth) {
  if (scaleLinksOnZoom) {
    return arrowWidth;
  } else {
    // Apply the same scaling logic as calculateLinkWidth to maintain proportionality
    arrowWidth = arrowWidth / transformationMatrix[0][0];
    // Apply the same non-linear scaling to avoid extreme widths
    arrowWidth *= min(5.0, max(1.0, transformationMatrix[0][0] * 0.01));
    return arrowWidth;
  }
}

void main() {
  pos = position;
  linkIndex = linkIndices;

  vec2 pointTexturePosA = (pointA + 0.5) / pointsTextureSize;
  vec2 pointTexturePosB = (pointB + 0.5) / pointsTextureSize;
  
  vec4 greyoutStatusA = texture2D(pointGreyoutStatus, pointTexturePosA);
  vec4 greyoutStatusB = texture2D(pointGreyoutStatus, pointTexturePosB);
  
  vec4 pointPositionA = texture2D(positionsTexture, pointTexturePosA);
  vec4 pointPositionB = texture2D(positionsTexture, pointTexturePosB);
  vec2 a = pointPositionA.xy;
  vec2 b = pointPositionB.xy;
  
  // Calculate direction vector and its perpendicular
  vec2 xBasis = b - a;
  vec2 yBasis = normalize(vec2(-xBasis.y, xBasis.x));

  // Calculate link distance and control point for curved link
  float linkDist = length(xBasis);
  float h = curvedLinkControlPointDistance;
  vec2 controlPoint = (a + b) / 2.0 + yBasis * linkDist * h;

  // Convert link distance to screen pixels
  float linkDistPx = linkDist * transformationMatrix[0][0];
  
  // Calculate line width using the width scale
  float linkWidth = width * widthScale;
  float k = 2.0;
  // Arrow width is proportionally larger than the line width
  float arrowWidth = linkWidth * k;
  arrowWidth *= arrowSizeScale;

  // Ensure arrow width difference is non-negative to prevent unwanted changes to link width
  float arrowWidthDifference = max(0.0, arrowWidth - linkWidth);

  // Calculate arrow width in pixels
  float arrowWidthPx = calculateArrowWidth(arrowWidth);

  // Calculate arrow length proportional to its width
  // 0.866 is approximately sqrt(3)/2 - related to equilateral triangle geometry
  // Cap the length to avoid overly long arrows on short links
  arrowLength = min(0.3, (0.866 * arrowWidthPx * 2.0) / linkDist);

  useArrow = arrow;
  if (useArrow > 0.5) {
    linkWidth += arrowWidthDifference;
  }

  if (renderMode > 0.0) {
    linkWidth += 5.0;
  }

  arrowWidthFactor = arrowWidthDifference / linkWidth;

  // Calculate final link width in pixels with smoothing
  float linkWidthPx = calculateLinkWidth(linkWidth);
  float smoothingPx = 0.5 / transformationMatrix[0][0];
  smoothing = smoothingPx / linkWidthPx;
  linkWidthPx += smoothingPx;

  // Calculate final color with opacity based on link distance
  vec3 rgbColor = color.rgb;
  // Adjust opacity based on link distance
  float opacity = color.a * linkOpacity * max(linkVisibilityMinTransparency, map(linkDistPx, linkVisibilityDistanceRange.g, linkVisibilityDistanceRange.r, 0.0, 1.0));

  // Apply greyed out opacity if either endpoint is greyed out
  if (greyoutStatusA.r > 0.0 || greyoutStatusB.r > 0.0) {
    opacity *= greyoutOpacity;
  }

  // Pass final color to fragment shader
  rgbaColor = vec4(rgbColor, opacity);

  // 👇 use for highlighting hovered link
  // if (hoveredLinkIndex == linkIndex) {
  //   rgbaColor = vec4(1.0, 0.0, 0.0, 1.0);
  // }

  // Calculate position on the curved path
  float t = position.x;
  float w = curvedWeight;
  
  float tPrev = t - 1.0 / curvedLinkSegments;
  float tNext = t + 1.0 / curvedLinkSegments;
  
  vec2 pointCurr = conicParametricCurve(a, b, controlPoint, t, w);
  
  vec2 pointPrev = conicParametricCurve(a, b, controlPoint, max(0.0, tPrev), w);
  vec2 pointNext = conicParametricCurve(a, b, controlPoint, min(tNext, 1.0), w);
  
  vec2 xBasisCurved = pointNext - pointPrev;
  vec2 yBasisCurved = normalize(vec2(-xBasisCurved.y, xBasisCurved.x));
  
  pointCurr += yBasisCurved * linkWidthPx * position.y;
  
  // Transform to clip space coordinates
  vec2 p = 2.0 * pointCurr / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  vec3 final = transformationMatrix * vec3(p, 1);
  
  gl_Position = vec4(final.rg, 0, 1);
}