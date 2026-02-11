#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 position, pointA, pointB;
in vec4 color;
in float width;
in float arrow;
in float linkIndices;

uniform sampler2D positionsTexture;
uniform sampler2D pointGreyoutStatus;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawLineUniforms {
  mat4 transformationMatrix;
  float pointsTextureSize;
  float widthScale;
  float linkArrowsSizeScale;
  float spaceSize;
  vec2 screenSize;
  vec2 linkVisibilityDistanceRange;
  float linkVisibilityMinTransparency;
  float linkOpacity;
  float greyoutOpacity;
  float curvedWeight;
  float curvedLinkControlPointDistance;
  float curvedLinkSegments;
  float scaleLinksOnZoom;
  float maxPointSize;
  float renderMode;
  float hoveredLinkIndex;
  vec4 hoveredLinkColor;
  float hoveredLinkWidthIncrease;
} drawLine;

#define transformationMatrix drawLine.transformationMatrix
#define pointsTextureSize drawLine.pointsTextureSize
#define widthScale drawLine.widthScale
#define linkArrowsSizeScale drawLine.linkArrowsSizeScale
#define spaceSize drawLine.spaceSize
#define screenSize drawLine.screenSize
#define linkVisibilityDistanceRange drawLine.linkVisibilityDistanceRange
#define linkVisibilityMinTransparency drawLine.linkVisibilityMinTransparency
#define linkOpacity drawLine.linkOpacity
#define greyoutOpacity drawLine.greyoutOpacity
#define curvedWeight drawLine.curvedWeight
#define curvedLinkControlPointDistance drawLine.curvedLinkControlPointDistance
#define curvedLinkSegments drawLine.curvedLinkSegments
#define scaleLinksOnZoom drawLine.scaleLinksOnZoom
#define maxPointSize drawLine.maxPointSize
#define renderMode drawLine.renderMode
#define hoveredLinkIndex drawLine.hoveredLinkIndex
#define hoveredLinkColor drawLine.hoveredLinkColor
#define hoveredLinkWidthIncrease drawLine.hoveredLinkWidthIncrease
#else
uniform mat3 transformationMatrix;
uniform float pointsTextureSize;
uniform float widthScale;
uniform float linkArrowsSizeScale;
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
uniform vec4 hoveredLinkColor;
uniform float hoveredLinkWidthIncrease;
#endif

out vec4 rgbaColor;
out vec2 pos;
out float arrowLength;
out float useArrow;
out float smoothing;
out float arrowWidthFactor;
out float linkIndex;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

float calculateLinkWidth(float width) {
  float linkWidth;
  if (scaleLinksOnZoom > 0.0) {
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
  if (scaleLinksOnZoom > 0.0) {
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
  
  vec4 greyoutStatusA = texture(pointGreyoutStatus, pointTexturePosA);
  vec4 greyoutStatusB = texture(pointGreyoutStatus, pointTexturePosB);
  
  vec4 pointPositionA = texture(positionsTexture, pointTexturePosA);
  vec4 pointPositionB = texture(positionsTexture, pointTexturePosB);
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
  arrowWidth *= linkArrowsSizeScale;

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

  arrowWidthFactor = arrowWidthDifference / linkWidth;

  // Calculate final link width in pixels with smoothing
  float linkWidthPx = calculateLinkWidth(linkWidth);
    
  if (renderMode > 0.0) {
    // Add 5 pixels padding for better hover detection
    linkWidthPx += 5.0 / transformationMatrix[0][0];
  } else {
      // Add pixel increase if this is the hovered link
    if (hoveredLinkIndex == linkIndex) {
      linkWidthPx += hoveredLinkWidthIncrease / transformationMatrix[0][0];
    }
  }
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

  // Apply hover color if this is the hovered link and hover color is defined
  if (hoveredLinkIndex == linkIndex && hoveredLinkColor.a > -0.5) {
    // Keep existing RGB values but multiply opacity with hover color opacity
    rgbaColor.rgb = hoveredLinkColor.rgb;
    rgbaColor.a *= hoveredLinkColor.a;
  }

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
  
  #ifdef USE_UNIFORM_BUFFERS
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif
  
  gl_Position = vec4(final.rg, 0, 1);
}