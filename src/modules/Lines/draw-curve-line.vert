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

#ifdef SPACE_3D
// 3D variants work in pixels throughout (the quad is extruded in screen space after
// projection), unlike the 2D functions above which return space units. `pxPerUnit`
// is the perspective-attenuated zoom factor at the vertex's depth.
float calculateLinkWidth3D(float width, float pxPerUnit) {
  float linkWidth;
  if (scaleLinksOnZoom > 0.0) {
    linkWidth = width * pxPerUnit;
  } else {
    linkWidth = width * min(5.0, max(1.0, pxPerUnit * 0.01));
  }
  // Limit link width based on whether it has an arrow
  if (useArrow > 0.5) {
    return min(linkWidth, maxPointSize * 2.0);
  } else {
    return min(linkWidth, maxPointSize);
  }
}

float calculateArrowWidth3D(float arrowWidth, float pxPerUnit) {
  if (scaleLinksOnZoom > 0.0) {
    return arrowWidth * pxPerUnit;
  } else {
    return arrowWidth * min(5.0, max(1.0, pxPerUnit * 0.01));
  }
}
#endif

void main() {
  pos = position;
  linkIndex = linkIndices;
  vLinkStyle = linkStyle;

  vec2 pointTexturePosA = (pointA + 0.5) / pointsTextureSize;
  vec2 pointTexturePosB = (pointB + 0.5) / pointsTextureSize;

  vec4 pointPositionA = texture(positionsTexture, pointTexturePosA);
  vec4 pointPositionB = texture(positionsTexture, pointTexturePosB);

  // Sample the source/target point colors so the fragment shader can build a gradient
  // along the link. Skipped entirely when the gradient is off — the fragment shader
  // only reads these varyings inside its own gradient branch, keyed on the same flag.
  // pointColorsTexture mirrors GraphData.pointColors, which is already sanitized on the
  // CPU (NaN / non-number channels replaced with the default), so no shader resolution
  // is needed here. Assigned before the 2D/3D split so both paths write the varyings.
  if (linkColorInterpolateFromEndpoints > 0.5) {
    vEndpointColorA = texture(pointColorsTexture, pointTexturePosA);
    vEndpointColorB = texture(pointColorsTexture, pointTexturePosB);
  }

  // Dash/dot pattern geometry, filled per-branch below. `dashSpan` is the link length in
  // the pattern's space (screen px when scaleLinksOnZoom is off, else world units);
  // `dashWidthScale` converts that branch's native linkWidthPx into the same space.
  float dashSpan = 0.0;
  float dashWidthScale = 1.0;

  #ifdef SPACE_3D
  // 3D mode: project both endpoints (z lives in the position texture's alpha channel)
  // and extrude the quad in screen space after projection. Curved links are rational
  // Bezier curves evaluated in world space, bent within the plane facing the camera so
  // they read as curved from any orbit angle; with curvature off (a single segment) or
  // a zero control-point distance the link stays a straight clip-space segment.
  vec3 a3 = vec3(pointPositionA.rg, pointPositionA.a);
  vec3 b3 = vec3(pointPositionB.rg, pointPositionB.a);
  vec4 clipA = transformationMatrix * vec4(a3, 1.0);
  vec4 clipB = transformationMatrix * vec4(b3, 1.0);
  bool isCurved = curvedLinkSegments > 1.0 && curvedLinkControlPointDistance != 0.0;

  vec3 controlPoint3 = (a3 + b3) * 0.5;
  // Clip w is affine in world position and the curve stays inside the convex hull of
  // {a, b, control point} (given a non-negative curve weight), so the minimum over
  // those three bounds w along the whole curve. Straight links only need the endpoints.
  float minW = min(clipA.w, clipB.w);
  if (isCurved) {
    vec3 dirLink = b3 - a3;
    // Bend within the camera-facing plane; fall back to world-up (then world-x) when
    // the link is (nearly) parallel to the view direction.
    vec3 bend = cross(cameraForward(transformationMatrix), dirLink);
    if (dot(bend, bend) < 1e-6) bend = cross(dirLink, vec3(0.0, 1.0, 0.0));
    if (dot(bend, bend) < 1e-6) bend = vec3(1.0, 0.0, 0.0);
    controlPoint3 += normalize(bend) * length(dirLink) * curvedLinkControlPointDistance;
    minW = min(minW, (transformationMatrix * vec4(controlPoint3, 1.0)).w);
  }
  if (minW <= 0.0) {
    // Some part of the link can reach behind the camera — cull the whole link.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    rgbaColor = vec4(0.0);
    arrowLength = 0.0;
    useArrow = 0.0;
    smoothing = 0.0;
    arrowWidthFactor = 0.0;
    return;
  }
  vec2 screenA = (clipA.xy / clipA.w) * 0.5 * screenSize;
  vec2 screenB = (clipB.xy / clipB.w) * 0.5 * screenSize;
  vec2 segPx = screenB - screenA;
  // Projected chord length in pixels — drives the visibility fade and the arrow
  // proportions for curved links too, matching 2D (which also uses the chord).
  float linkDistPx = length(segPx);

  // Centerline point for this vertex and the screen-space tangent to extrude along.
  vec4 clipCurr;
  vec2 tangentPx;
  if (isCurved) {
    float tCurr = position.x;
    float tPrev = max(0.0, tCurr - 1.0 / curvedLinkSegments);
    float tNext = min(1.0, tCurr + 1.0 / curvedLinkSegments);
    clipCurr = transformationMatrix * vec4(conicParametricCurve(a3, b3, controlPoint3, tCurr, curvedWeight), 1.0);
    vec4 clipPrev = transformationMatrix * vec4(conicParametricCurve(a3, b3, controlPoint3, tPrev, curvedWeight), 1.0);
    vec4 clipNext = transformationMatrix * vec4(conicParametricCurve(a3, b3, controlPoint3, tNext, curvedWeight), 1.0);
    // Every curve sample has w > 0 (guarded above), so the divides are safe.
    tangentPx = (clipNext.xy / clipNext.w - clipPrev.xy / clipPrev.w) * 0.5 * screenSize;
  } else {
    // Straight segment: interpolate in clip space (projectively correct for straight lines).
    clipCurr = mix(clipA, clipB, position.x);
    tangentPx = segPx;
  }
  // Pixels per space unit at this vertex's depth — gives a natural perspective
  // taper along the link when widths scale with zoom.
  float pxPerUnit = pxPerSpaceUnit(transformationMatrix, screenSize, clipCurr.w);

  // Dash pattern space in 3D. Screen mode uses the projected chord length in px;
  // world mode uses the straight-line world length. linkWidthPx (below) is in px,
  // so world mode divides it back into world units to match dashSpan.
  float worldLen3D = length(b3 - a3);
  dashSpan = scaleLinksOnZoom > 0.0 ? worldLen3D : linkDistPx;
  dashWidthScale = scaleLinksOnZoom > 0.0 ? (pxPerUnit > 0.0 ? 1.0 / pxPerUnit : 0.0) : 1.0;
  #else
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

  // Dash pattern space in 2D. Screen mode measures in screen px (linkDist * zoom == linkDistPx);
  // world mode measures in world units. linkWidthPx (below) is in world units here, so the same
  // scale converts it into the pattern's space.
  dashWidthScale = scaleLinksOnZoom > 0.0 ? 1.0 : transformationMatrix[0][0];
  dashSpan = linkDist * dashWidthScale;
  #endif

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
  // Calculate arrow length proportional to its width
  // 0.866 is approximately sqrt(3)/2 - related to equilateral triangle geometry
  // Cap the length to avoid overly long arrows on short links
  #ifdef SPACE_3D
  float arrowWidthPx = calculateArrowWidth3D(arrowWidth, pxPerUnit);
  arrowLength = min(0.3, (0.866 * arrowWidthPx * 2.0) / max(linkDistPx, 1e-6));
  #else
  float arrowWidthPx = calculateArrowWidth(arrowWidth);
  arrowLength = min(0.3, (0.866 * arrowWidthPx * 2.0) / linkDist);
  #endif

  useArrow = arrow;
  if (useArrow > 0.5) {
    linkWidth += arrowWidthDifference;
  }

  arrowWidthFactor = arrowWidthDifference / linkWidth;

  // Calculate final link width with smoothing.
  // In 3D everything below is in pixels; in 2D it is in space units (px / zoom factor).
  #ifdef SPACE_3D
  float linkWidthPx = calculateLinkWidth3D(linkWidth, pxPerUnit);

  if (renderMode > 0.0) {
    // Add 5 pixels padding for better hover detection
    linkWidthPx += 5.0;
  }
  // Match the visible-pass width increases so the pickable area covers the full rendered link
  if (hoveredLinkIndex == linkIndex) {
    linkWidthPx += hoveredLinkWidthIncrease;
  }
  if (focusedLinkIndex == linkIndex) {
    linkWidthPx += focusedLinkWidthIncrease;
  }
  float smoothingPx = 0.5;
  smoothing = smoothingPx / linkWidthPx;
  linkWidthPx += smoothingPx;
  #else
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
  #endif

  // Publish the dash pattern span and the link thickness in the pattern's space so the
  // fragment shader can draw dashes/dots (dotted dots are sized to the stroke width).
  // Both are in the same units (screen px or world), keeping dots round in either mode.
  vLinkDashSpan = dashSpan;
  vLinkDashWidth = linkWidthPx * dashWidthScale;

  // Calculate final color with opacity based on link distance
  vec3 rgbColor = lineColor.rgb;
  // Fade long links toward the minimum transparency, saturating at 1 so links
  // shorter than the range minimum never exceed the configured opacity. A
  // degenerate (or inverted) range acts as a hard threshold instead of
  // dividing by zero in map().
  float visibilityFade = linkVisibilityDistanceRange.g > linkVisibilityDistanceRange.r
    ? map(linkDistPx, linkVisibilityDistanceRange.g, linkVisibilityDistanceRange.r, 0.0, 1.0)
    : (linkDistPx <= linkVisibilityDistanceRange.g ? 1.0 : 0.0);
  float opacity = lineColor.a * linkOpacity * clamp(visibilityFade, linkVisibilityMinTransparency, 1.0);

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

  #ifdef SPACE_3D
  // Offset the centerline point along the screen-space perpendicular of its tangent.
  // The offset is pre-multiplied by w so it survives the perspective divide.
  vec2 normalPx = dot(tangentPx, tangentPx) > 0.0 ? normalize(vec2(-tangentPx.y, tangentPx.x)) : vec2(0.0, 1.0);
  clipCurr.xy += normalPx * (linkWidthPx * position.y) * (2.0 / screenSize) * clipCurr.w;
  gl_Position = clipCurr;
  #else
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
  #endif
}