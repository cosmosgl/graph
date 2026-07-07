#version 300 es
precision highp float;

// Per-point energy decay (see design-energy-diffusion.md): multiplies the
// energy (green channel of the pinned/energy state texture) by the per-tick
// decay factor and snaps values below the freeze threshold to zero. The
// pinned flag (red channel) and the unused channels pass through unchanged.

uniform sampler2D energyTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform decayEnergyUniforms {
  float energyDecay;
} decayEnergy;

#define energyDecay decayEnergy.energyDecay
#else
uniform float energyDecay;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Keep in sync with ForceLink/diffuse-energy.ts
const float FREEZE_THRESHOLD = 0.01;

void main() {
  vec4 state = texture(energyTexture, textureCoords);
  float energy = state.g * energyDecay;
  if (energy < FREEZE_THRESHOLD) energy = 0.0;
  fragColor = vec4(state.r, energy, state.ba);
}
