#version 300 es
precision highp float;

// t-SNE normalization damping: exponential moving average of the global Z.
//
// The raw Z is recomputed each tick from the PREVIOUS tick's positions (the
// GPU ping-pong forces a one-tick lag), which makes the repulsion ∝ 1/Z a
// delayed-feedback loop — and delayed feedback on the layout scale rings
// (the embedding overshoots to the space walls, then relaxes back). Low-pass
// filtering Z damps that oscillation:
//
//   Z_smooth = mix(Z_smooth_prev, Z_raw, emaAlpha)
//
// with a small emaAlpha, so Z drifts toward the true value over several ticks
// instead of chasing the lagged signal frame-to-frame. Ping-ponged: reads the
// previous smoothed Z, writes the new one.

uniform sampler2D rawInput;   // 1×1 raw Z from the reduction chain (this tick)
uniform sampler2D prevInput;  // 1×1 smoothed Z from the previous tick

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform reduceEmaUniforms {
  float emaAlpha;
} reduceEma;

#define emaAlpha reduceEma.emaAlpha
#else
uniform float emaAlpha;
#endif

out vec4 fragColor;

void main() {
  float raw = texelFetch(rawInput, ivec2(0), 0).r;
  float prev = texelFetch(prevInput, ivec2(0), 0).r;
  fragColor = vec4(mix(prev, raw, emaAlpha), 0.0, 0.0, 0.0);
}
