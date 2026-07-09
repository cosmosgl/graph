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
in float vLinkDashSpan;
in float vLinkDashWidth;
in vec4 vEndpointColorA;
in vec4 vEndpointColorB;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawLineFragmentUniforms {
  float renderMode;
  float linkDashLength;
  float linkDashGap;
  float linkColorInterpolateFromEndpoints;
} drawLineFrag;

#define renderMode drawLineFrag.renderMode
#define linkDashLength drawLineFrag.linkDashLength
#define linkDashGap drawLineFrag.linkDashGap
#define linkColorInterpolateFromEndpoints drawLineFrag.linkColorInterpolateFromEndpoints
#else
// renderMode: 0.0 = normal rendering, 1.0 = index buffer rendering for picking
uniform float renderMode;
uniform float linkDashLength;
uniform float linkDashGap;
uniform float linkColorInterpolateFromEndpoints;
#endif

out vec4 fragColor;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

// Anti-aliased on/off mask for one dash period. `phase` is distance-along-line in px,
// `on` is the lit dash length, `period` is on + gap, `aa` is the smoothing half-width in px.
float strokeMask(float phase, float on, float period, float aa) {
  float m = mod(phase, period);
  return smoothstep(-aa, aa, m) * (1.0 - smoothstep(on - aa, on + aa, m));
}

void main() {
  float opacity = 1.0;
  vec3 color = rgbaColor.rgb;

  // Gradient links: interpolate RGB from the source point color to the target point color
  // along the link. Opacity (visibility / greyout / hover) still comes from rgbaColor.a.
  if (linkColorInterpolateFromEndpoints > 0.5) {
    color = mix(vEndpointColorA.rgb, vEndpointColorB.rgb, clamp(pos.x, 0.0, 1.0));
  }

  if (useArrow > 0.5) {
    float end_arrow = 0.5 + arrowLength / 2.0;
    float start_arrow = end_arrow - arrowLength;
    float arrowWidthDelta = arrowWidthFactor / 2.0;
    float linkOpacity = rgbaColor.a * smoothstep(0.5 - arrowWidthDelta, 0.5 - arrowWidthDelta - smoothing / 2.0, abs(pos.y));
    float arrowOpacity = 1.0;
    if (pos.x > start_arrow && pos.x < start_arrow + arrowLength) {
      float xmapped = map(pos.x, start_arrow, end_arrow, 0.0, 1.0);
      arrowOpacity = rgbaColor.a * smoothstep(xmapped - smoothing, xmapped, map(abs(pos.y), 0.5, 0.0, 0.0, 1.0));
      if (linkOpacity != arrowOpacity) {
        linkOpacity = max(linkOpacity, arrowOpacity);
      }
    }
    opacity = linkOpacity;
  } else opacity = rgbaColor.a * smoothstep(0.5, 0.5 - smoothing, abs(pos.y));

  // Dashed / dotted stroke patterns. Applied to the visible pass only (renderMode == 0.0)
  // so that gaps stay fully pickable in the index pass. The arrowhead region is left solid.
  if (renderMode < 0.5 && vLinkStyle > 0.5) {
    float end_arrow = 0.5 + arrowLength / 2.0;
    float start_arrow = end_arrow - arrowLength;
    bool inArrowHead = (useArrow > 0.5) && (pos.x > start_arrow) && (pos.x < end_arrow);
    if (!inArrowHead) {
      // Distance along the link in the dash pattern's space (screen px or world units; see the vertex shader).
      // fwidth() gives the screen-space rate of change, so anti-aliasing stays ~1px wide in either space.
      float phase = clamp(pos.x, 0.0, 1.0) * vLinkDashSpan;
      if (vLinkStyle < 1.5) {
        // Dashed
        float period = max(linkDashLength + linkDashGap, 0.001);
        float aa = max(fwidth(phase), 1e-4);
        opacity *= strokeMask(phase, linkDashLength, period, aa);
      } else {
        // Dotted: round dots sized to the stroke width, spaced by diameter + gap.
        float diameter = vLinkDashWidth;
        float period = max(diameter + linkDashGap, 0.001);
        float localX = mod(phase, period) - period * 0.5;
        float localY = pos.y * vLinkDashWidth;
        float r = length(vec2(localX, localY));
        float aa = max(fwidth(r), 1e-4);
        opacity *= 1.0 - smoothstep(diameter * 0.5 - aa, diameter * 0.5 + aa, r);
      }
    }
  }

  if (renderMode > 0.0) {
    if (opacity <= 0.0) discard;
    fragColor = vec4(linkIndex, 0.0, 0.0, 1.0);
  } else fragColor = vec4(color, opacity);

}
