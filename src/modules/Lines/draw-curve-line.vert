#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 position, pointA, pointB;
in vec4 sourceColor;
in vec4 targetColor;
in float sourceWidth;
in float targetWidth;
in float arrow;
in float linkIndices;
in float linkStyle;

uniform sampler2D positionsTexture;
uniform sampler2D linkStatus;
uniform sampler2D exitTexture;
uniform sampler2D pointColorsTexture;

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
  float hoveredLinkWidthIncrease;
  float isLinkHighlightingActive;
  float linkStatusTextureSize;
  float focusedLinkIndex;
  float focusedLinkWidthIncrease;
  float transitionProgress;
  float animateColors;
  float animateWidths;
  float animatePositions;
  vec4 pointDefaultColor;
  float linkColorInterpolateFromEndpoints;
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
#define hoveredLinkWidthIncrease drawLine.hoveredLinkWidthIncrease
#define isLinkHighlightingActive drawLine.isLinkHighlightingActive
#define linkStatusTextureSize drawLine.linkStatusTextureSize
#define focusedLinkIndex drawLine.focusedLinkIndex
#define focusedLinkWidthIncrease drawLine.focusedLinkWidthIncrease
#define transitionProgress drawLine.transitionProgress
#define animateColors drawLine.animateColors
#define animateWidths drawLine.animateWidths
#define animatePositions drawLine.animatePositions
#define pointDefaultColor drawLine.pointDefaultColor
#define linkColorInterpolateFromEndpoints drawLine.linkColorInterpolateFromEndpoints
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
uniform float hoveredLinkWidthIncrease;
uniform float isLinkHighlightingActive;
uniform float linkStatusTextureSize;
uniform float focusedLinkIndex;
uniform float focusedLinkWidthIncrease;
uniform float transitionProgress;
uniform float animateColors;
uniform float animateWidths;
uniform float animatePositions;
uniform vec4 pointDefaultColor;
uniform float linkColorInterpolateFromEndpoints;
#endif

out vec4 rgbaColor;
out vec2 pos;
out float arrowLength;
out float useArrow;
out float smoothing;
out float arrowWidthFactor;
out float linkIndex;
// Per-instance constants (no per-vertex variation), so `flat` skips interpolation.
flat out float vLinkStyle;
flat out float vLinkDashSpan;
flat out float vLinkDashWidth;
flat out vec4 vEndpointColorA;
flat out vec4 vEndpointColorB;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

// Resolves NaN color channels the way the point draw shader does: NaN means "use the
// default" — the config default, blended toward the exit default as the endpoint fades
// out. Mirrors resolveColor in draw-points.vert.
vec4 resolveColor(vec4 color, float exitRamp) {
  vec4 defaultColor = mix(pointDefaultColor, vec4(EXIT_DEFAULT_COLOR_CHANNEL), exitRamp);
  return mix(color, defaultColor, isnan(color));
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
  vLinkStyle = linkStyle;

  vec2 pointTexturePosA = (pointA + 0.5) / pointsTextureSize;
  vec2 pointTexturePosB = (pointB + 0.5) / pointsTextureSize;

  vec4 pointPositionA = texture(positionsTexture, pointTexturePosA);
  vec4 pointPositionB = texture(positionsTexture, pointTexturePosB);
  vec2 a = pointPositionA.xy;
  vec2 b = pointPositionB.xy;

  // Skip links touching an absent (NaN position) point — interpolating from a NaN
  // endpoint would produce garbage geometry. Collapse the link off-screen. This only
  // catches snap removals: an animated removal freezes the endpoint at its last real
  // position, so absence must be read from the exit texture below.
  if (isnan(a.x) || isnan(a.y) || isnan(b.x) || isnan(b.y)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Exit status of both endpoints (R = previous absence, G = current absence). A link
  // is only as present as its endpoints.
  vec4 exitStatusA = texture(exitTexture, pointTexturePosA);
  vec4 exitStatusB = texture(exitTexture, pointTexturePosB);

  // Picking must not report a link to a removed point even mid-fade — same rule as
  // point picking, which excludes on current absence.
  if (renderMode > 0.0 && (exitStatusA.g > 0.5 || exitStatusB.g > 0.5)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Visible pass: fade the link with the same animated exit ramp the point fade uses
  // (blend R→G during a position transition, settled G otherwise), so a removed
  // point's links fade out in sync with it instead of dangling at full opacity.
  float exitA = animatePositions > 0.0 ? mix(exitStatusA.r, exitStatusA.g, transitionProgress) : exitStatusA.g;
  float exitB = animatePositions > 0.0 ? mix(exitStatusB.r, exitStatusB.g, transitionProgress) : exitStatusB.g;
  float exitPresence = (1.0 - exitA) * (1.0 - exitB);
  if (exitPresence <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Sample the source/target point colors so the fragment shader can build a gradient
  // along the link. Skipped entirely when the gradient is off — the fragment shader
  // only reads these varyings inside its own gradient branch, keyed on the same flag.
  // The texture mirrors GraphData.pointColors, so channels may be NaN ("use the
  // default") — resolve them with the endpoint's exit ramp, like the point draw.
  if (linkColorInterpolateFromEndpoints > 0.5) {
    vEndpointColorA = resolveColor(texture(pointColorsTexture, pointTexturePosA), exitA);
    vEndpointColorB = resolveColor(texture(pointColorsTexture, pointTexturePosB), exitB);
  }

  // Calculate direction vector and its perpendicular
  vec2 xBasis = b - a;
  vec2 yBasis = normalize(vec2(-xBasis.y, xBasis.x));

  // Calculate link distance and control point for curved link
  float linkDist = length(xBasis);
  float h = curvedLinkControlPointDistance;
  vec2 controlPoint = (a + b) / 2.0 + yBasis * linkDist * h;

  // Convert link distance to screen pixels
  float linkDistPx = linkDist * transformationMatrix[0][0];

  // Dash/dot pattern space. When links keep a constant on-screen size (scaleLinksOnZoom = false)
  // the pattern is measured in screen pixels (fixed dash size, but it slides as the link's
  // on-screen length changes with zoom). When links scale with zoom it is measured in world units,
  // which locks the pattern to the link so it scales with zoom instead of crawling.
  float dashUnitScale = scaleLinksOnZoom > 0.0 ? 1.0 : transformationMatrix[0][0];
  vLinkDashSpan = linkDist * dashUnitScale;

  float lineWidthBase = animateWidths > 0.0
    ? mix(sourceWidth, targetWidth, transitionProgress)
    : targetWidth;
  vec4 lineColor = animateColors > 0.0
    ? mix(sourceColor, targetColor, transitionProgress)
    : targetColor;
  
  // Calculate line width using the width scale
  float linkWidth = lineWidthBase * widthScale;
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
    // Match the visible-pass width increases so the pickable area covers the full rendered link
    if (hoveredLinkIndex == linkIndex) {
      linkWidthPx += hoveredLinkWidthIncrease / transformationMatrix[0][0];
    }
    if (focusedLinkIndex == linkIndex) {
      linkWidthPx += focusedLinkWidthIncrease / transformationMatrix[0][0];
    }
  } else {
    // Add pixel increase if this is the hovered link
    if (hoveredLinkIndex == linkIndex) {
      linkWidthPx += hoveredLinkWidthIncrease / transformationMatrix[0][0];
    }
    // Add pixel increase if this is the focused link
    if (focusedLinkIndex == linkIndex) {
      linkWidthPx += focusedLinkWidthIncrease / transformationMatrix[0][0];
    }
  }
  float smoothingPx = 0.5 / transformationMatrix[0][0];
  smoothing = smoothingPx / linkWidthPx;
  linkWidthPx += smoothingPx;

  // Link thickness expressed in the dash pattern's space, so dotted-link dots match the stroke width.
  // linkWidthPx is in world units; `dashUnitScale` converts it to screen px (scaleLinksOnZoom = false)
  // or keeps it in world units (scaleLinksOnZoom = true), matching vLinkDashSpan.
  vLinkDashWidth = linkWidthPx * dashUnitScale;



  // Calculate final color with opacity based on link distance
  vec3 rgbColor = lineColor.rgb;
  // Adjust opacity based on link distance
  float opacity = lineColor.a * linkOpacity * max(linkVisibilityMinTransparency, map(linkDistPx, linkVisibilityDistanceRange.g, linkVisibilityDistanceRange.r, 0.0, 1.0));
  // Fade with the exit ramp of the endpoints (1 = both fully present).
  opacity *= exitPresence;

  // Apply greyed-out opacity from link status texture
  if (isLinkHighlightingActive > 0.0 && linkStatusTextureSize > 0.0) {
    float texX = mod(linkIndices, linkStatusTextureSize);
    float texY = floor(linkIndices / linkStatusTextureSize);
    vec2 linkStatusCoord = (vec2(texX, texY) + 0.5) / linkStatusTextureSize;
    vec4 linkStatusValue = texture(linkStatus, linkStatusCoord);
    if (linkStatusValue.r > 0.0) {
      opacity *= greyoutOpacity;
    }
  }

  // Pass final color to fragment shader. Hover color is applied in the fragment
  // shader, after the endpoint gradient, so it wins for gradient links too.
  rgbaColor = vec4(rgbColor, opacity);

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