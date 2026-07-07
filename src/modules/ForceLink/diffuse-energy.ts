// Energy diffusion along links (see design-energy-diffusion.md): each point's
// energy (green channel of the pinned/energy state texture) is raised to the
// wavefront maximum `energyDiffusion * linkStrength * neighborEnergy` over its
// incident links. Link strength is the raw (non-sqrt) value stored in the blue
// channel of the link properties texture. The pinned flag (red channel) and
// the unused channels are copied through unchanged.
export function diffuseEnergyFrag (maxLinks: number): string {
  return `#version 300 es
precision highp float;

uniform sampler2D energyTexture; // Pinned/energy state: r - pinned, g - energy
uniform sampler2D linkInfoTexture; // Texture storing first link indices and amount
uniform sampler2D linkIndicesTexture;
uniform sampler2D linkPropertiesTexture; // Texture storing link bias, sqrt(strength) and raw strength

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform diffuseEnergyUniforms {
  float pointsTextureSize;
  float linksTextureSize;
  float energyDiffusion;
} diffuseEnergy;

#define pointsTextureSize diffuseEnergy.pointsTextureSize
#define linksTextureSize diffuseEnergy.linksTextureSize
#define energyDiffusion diffuseEnergy.energyDiffusion
#else
uniform float pointsTextureSize;
uniform float linksTextureSize;
uniform float energyDiffusion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

const float MAX_LINKS = ${maxLinks}.0;
// Keep in sync with decay-energy.frag
const float FREEZE_THRESHOLD = 0.01;

void main() {
  vec4 state = texture(energyTexture, textureCoords);
  float incoming = 0.0;

  vec4 linkInfo = texture(linkInfoTexture, textureCoords);
  float iCount = linkInfo.r;
  float jCount = linkInfo.g;
  float linkAmount = linkInfo.b;
  if (linkAmount > 0.0) {
    for (float i = 0.0; i < MAX_LINKS; i += 1.0) {
      if (i < linkAmount) {
        if (iCount >= linksTextureSize) {
          iCount = 0.0;
          jCount += 1.0;
        }
        vec2 linkTextureIndex = (vec2(iCount, jCount) + 0.5) / linksTextureSize;
        vec4 connectedPointIndex = texture(linkIndicesTexture, linkTextureIndex);
        float strength = texture(linkPropertiesTexture, linkTextureIndex).b;

        iCount += 1.0;

        float neighborEnergy = texture(energyTexture, (connectedPointIndex.rg + 0.5) / pointsTextureSize).g;
        incoming = max(incoming, strength * neighborEnergy);
      }
    }
  }

  float energy = max(state.g, energyDiffusion * incoming);
  if (energy < FREEZE_THRESHOLD) energy = 0.0;
  fragColor = vec4(state.r, energy, state.ba);
}
  `
}
