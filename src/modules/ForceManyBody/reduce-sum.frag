#version 300 es
precision highp float;

// One step of the t-SNE normalization (Z) reduction: sums 2×2 blocks of the
// input into each output texel, halving the texture until 1×1. The first step
// reads the per-point partial sums S_i = Σⱼ mass·w(dᵢⱼ) that the repulsion
// passes accumulated into the velocity texture's ALPHA channel; later steps
// read the RED channel of the previous reduction target. The final 1×1 value
// is Z = Σᵢ Sᵢ = Σ_{k≠l} w_kl, consumed (one tick lagged) by the repulsion
// shaders' TSNE_KERNEL branch.

uniform sampler2D reduceInput;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform reduceSumUniforms {
  float inputWidth;
  float inputHeight;
  float readAlpha;
} reduceSum;

#define inputWidth reduceSum.inputWidth
#define inputHeight reduceSum.inputHeight
#define readAlpha reduceSum.readAlpha
#else
uniform float inputWidth;
uniform float inputHeight;
uniform float readAlpha;
#endif

in vec2 textureCoords;
out vec4 fragColor;

float fetch (ivec2 pixel) {
  if (pixel.x >= int(inputWidth) || pixel.y >= int(inputHeight)) return 0.0;
  vec4 texel = texelFetch(reduceInput, pixel, 0);
  return readAlpha > 0.5 ? texel.a : texel.r;
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  float sum = fetch(base)
    + fetch(base + ivec2(1, 0))
    + fetch(base + ivec2(0, 1))
    + fetch(base + ivec2(1, 1));
  fragColor = vec4(sum, 0.0, 0.0, 0.0);
}
