precision highp float;

varying vec4 rgbaColor;
varying vec2 pos;
varying float arrowLength;
varying float useArrow;
varying float smoothing;
varying float arrowWidthFactor;
varying float linkIndex;

// renderMode: 0.0 = normal rendering, 1.0 = index buffer rendering for picking
uniform float renderMode;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

void main() {
  float opacity = 1.0;
  vec3 color = rgbaColor.rgb;

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
  
  if (renderMode > 0.0) {
    if (opacity > 0.0) {
      gl_FragColor = vec4(linkIndex, 0.0, 0.0, 1.0);
    } else {
      gl_FragColor = vec4(-1.0, 0.0, 0.0, 0.0);
    }
  } else gl_FragColor = vec4(color, opacity);

}