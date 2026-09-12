#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec4 rgbaColor;
in vec2 pos;
in float arrowLength;
in float useArrow;
in float smoothing;
in float arrowWidthFactor;
in float linkIndex;
flat in float vLinkStyle;
flat in float vLinkDashSpan;
flat in float vLinkDashWidth;
flat in vec4 vEndpointColorA;
flat in vec4 vEndpointColorB;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawLineFragmentUniforms {
  float renderMode;
  float linkDashLength;
  float linkDashGap;
  float linkColorInterpolateFromEndpoints;
  float hoveredLinkIndex;
  vec4 hoveredLinkColor;
  float linkBlending;
} drawLineFrag;

#define renderMode drawLineFrag.renderMode
#define linkDashLength drawLineFrag.linkDashLength
#define linkDashGap drawLineFrag.linkDashGap
#define linkColorInterpolateFromEndpoints drawLineFrag.linkColorInterpolateFromEndpoints
#define hoveredLinkIndex drawLineFrag.hoveredLinkIndex
#define hoveredLinkColor drawLineFrag.hoveredLinkColor
#define linkBlending drawLineFrag.linkBlending
#else
// renderMode: 0.0 = normal rendering, 1.0 = index buffer rendering for picking
uniform float renderMode;
uniform float linkDashLength;
uniform float linkDashGap;
uniform float linkColorInterpolateFromEndpoints;
uniform float hoveredLinkIndex;
uniform vec4 hoveredLinkColor;
uniform float linkBlending;
#endif

out vec4 fragColor;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

// LinkStyle enum values (must match `LinkStyle` in modules/GraphData). Compared with
// exact equality, like the point shapes: the CPU sanitizer guarantees exact integers
// and vLinkStyle is flat, so an unknown future style matches nothing and renders solid.
const float LINK_STYLE_DASHED = 1.0;
const float LINK_STYLE_DOTTED = 2.0;

// Anti-aliased on/off mask for one dash period. `phase` is distance-along-line in px,
// `on` is the lit dash length, `period` is on + gap, `aa` is the smoothing half-width in px.
float strokeMask(float phase, float on, float period, float aa) {
  float m = mod(phase, period);
  return smoothstep(-aa, aa, m) * (1.0 - smoothstep(on - aa, on + aa, m));
}

void main() {
  // Geometric coverage only (stroke / arrow / dash). Color alpha is applied after.
  float coverage = 1.0;
  vec3 color = rgbaColor.rgb;

  // Arrowhead extent along the link (pos.x space) — used by the arrow rendering
  // and by the dash mask, which leaves the arrowhead solid.
  float end_arrow = 0.5 + arrowLength / 2.0;
  float start_arrow = end_arrow - arrowLength;

  // Gradient links: interpolate RGB from the source point color to the target point color
  // along the link. Opacity (visibility / greyout) still comes from rgbaColor.a.
  if (linkColorInterpolateFromEndpoints > 0.5) {
    color = mix(vEndpointColorA.rgb, vEndpointColorB.rgb, clamp(pos.x, 0.0, 1.0));
  }

  if (useArrow > 0.5) {
    // pos.y spans the quad, which is the arrow width plus a ramp. arrowWidthFactor is a fraction
    // of the arrow width alone, so edges derived from it scale by (1 - smoothing) = arrow / quad.
    float preRamp = 1.0 - smoothing;
    float bodyEdge = (0.5 - arrowWidthFactor / 2.0) * preRamp;
    float headBase = 0.5 * preRamp;
    // Body edge, ramp centred on it as for the plain stroke.
    float linkCoverage = smoothstep(bodyEdge + smoothing / 2.0, bodyEdge - smoothing / 2.0, abs(pos.y));
    float arrowCoverage = 1.0;
    if (pos.x > start_arrow && pos.x < start_arrow + arrowLength) {
      // Arrowhead taper, from headBase at its base to the centreline at its tip; ramp centred on it.
      float taper = headBase * (1.0 - map(pos.x, start_arrow, end_arrow, 0.0, 1.0));
      arrowCoverage = 1.0 - smoothstep(taper - smoothing / 2.0, taper + smoothing / 2.0, abs(pos.y));
      if (linkCoverage != arrowCoverage) {
        linkCoverage = max(linkCoverage, arrowCoverage);
      }
    }
    coverage = linkCoverage;
  } else coverage = smoothstep(0.5, 0.5 - smoothing, abs(pos.y));

  // Dashed / dotted stroke patterns. Applied to the visible pass only (renderMode == 0.0)
  // so that gaps stay fully pickable in the index pass. The arrowhead region is left solid.
  if (renderMode < 0.5 && (vLinkStyle == LINK_STYLE_DASHED || vLinkStyle == LINK_STYLE_DOTTED)) {
    bool inArrowHead = (useArrow > 0.5) && (pos.x > start_arrow) && (pos.x < end_arrow);
    if (!inArrowHead) {
      // Distance along the link in the dash pattern's space (screen px or world units; see the vertex shader).
      // fwidth() gives the screen-space rate of change, so the ramp is EDGE_RAMP_PX device pixels in either space.
      float phase = clamp(pos.x, 0.0, 1.0) * vLinkDashSpan;
      if (vLinkStyle == LINK_STYLE_DASHED) {
        float period = max(linkDashLength + linkDashGap, 0.001);
        // Half a ramp in the pattern's units: fwidth(phase) is the change in phase per device pixel.
        float aa = max(fwidth(phase), 1e-4) * (EDGE_RAMP_PX * 0.5);
        coverage *= strokeMask(phase, linkDashLength, period, aa);
      } else {
        // Dotted: round dots sized to the stroke, the quad less its ramp; spaced by diameter + gap.
        float diameter = vLinkDashWidth * (1.0 - smoothing);
        if (linkBlending < 0.5) {
          // Unblended keeps only pixels whose centre is inside the dot. A dot under √2 device
          // px can miss every pixel centre and vanish; at √2 it always holds one. Pattern units
          // per device pixel from the phase's gradient (the pattern space is isotropic).
          float pxInPattern = max(length(vec2(dFdx(phase), dFdy(phase))), 1e-4);
          diameter = max(diameter, 1.4142136 * pxInPattern);
        }
        float period = max(diameter + linkDashGap, 0.001);
        float localX = mod(phase, period) - period * 0.5;
        float localY = pos.y * vLinkDashWidth;
        float r = length(vec2(localX, localY));
        // Half a ramp in the pattern's units: fwidth(r) is the change in r per device pixel.
        float aa = max(fwidth(r), 1e-4) * (EDGE_RAMP_PX * 0.5);
        coverage *= 1.0 - smoothstep(diameter * 0.5 - aa, diameter * 0.5 + aa, r);
      }
    }
  }

  float opacity = rgbaColor.a * coverage;

  // Apply hover color if this is the hovered link and hover color is defined.
  // Done last — after the gradient and the dash mask — so hover wins over every
  // color source (per-link color from the vertex stage and the endpoint gradient
  // alike), while the dash pattern and AA stay intact in the hover color.
  if (hoveredLinkIndex == linkIndex && hoveredLinkColor.a > -0.5) {
    color = hoveredLinkColor.rgb;
    opacity *= hoveredLinkColor.a;
  }

  if (renderMode > 0.0) {
    if (opacity <= 0.0) discard;
    fragColor = vec4(linkIndex, 0.0, 0.0, 1.0);
  } else if (linkBlending < 0.5) {
    // Unblended: opaque, hard edges. Soft fringes would write full RGB with partial
    // alpha; canvas compositing treats that as premultiplied and the edge reads
    // brighter than the solid core. Every fade is centred on its geometric edge, so
    // coverage 0.5 is that edge: keep the pixels whose centre is inside the stroke.
    // The vertex stage keeps unblended strokes at least a device pixel wide.
    if (coverage < 0.5 || opacity <= 0.0) discard;
    fragColor = vec4(color, 1.0);
  } else {
    fragColor = vec4(color, opacity);
  }

}
