#version 300 es
#ifdef GL_ES
precision highp float;
#endif

// t-SNE integrator (reference optimizer): momentum + Jacobs' per-point gains.
//
// The other kernels integrate each force separately as `position += force ·
// friction`, with convergence coming from alpha decay. Reference t-SNE instead
// descends the FULL gradient with a persistent velocity and per-axis gains.
//
// IMPORTANT: the force passes accumulate a FORCE, i.e. −gradient (repulsion
// points away from other points, attraction toward neighbours), so the reference
// formulation's signs are mirrored here:
//
//   reference (gradient g):  gain += 0.2 if v·g < 0;  v = momentum·v − η·gain·g
//   here      (force F=−g):  gain += 0.2 if v·F > 0;  v = momentum·v + η·gain·F
//
// Gains grow along axes that keep pushing the same way and shrink where the
// force oscillates, which is what makes clusters tighten crisply.
//
// This shader computes both outputs from the same inputs, selected by
// `writeGain`, so velocity and gains are two single-attachment passes instead of
// one multi-target pass (RGBA can't hold 3D velocity and 3D gains together).

uniform sampler2D velocityTexture;  // persistent v (previous tick)
uniform sampler2D gainTexture;      // per-axis gains (previous tick)
uniform sampler2D forceTexture;     // this tick's accumulated force

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform tsneIntegrateUniforms {
  float momentum;
  float learningRate;
  float minGain;
  float writeGain;
} tsneIntegrate;

#define momentum tsneIntegrate.momentum
#define learningRate tsneIntegrate.learningRate
#define minGain tsneIntegrate.minGain
#define writeGain tsneIntegrate.writeGain
#else
uniform float momentum;
uniform float learningRate;
uniform float minGain;
uniform float writeGain;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 velocity = texture(velocityTexture, textureCoords);
  vec4 gain = texture(gainTexture, textureCoords);
  vec4 force = texture(forceTexture, textureCoords);

  // The force passes accumulate the force in rg (+ b in 3D, matching how
  // update-position.frag reads velocity); the alpha channel carries the t-SNE Z
  // partial sum and must not be touched here.
  #ifdef SPACE_3D
  #define COMPONENTS vec3
  COMPONENTS f = force.rgb;
  COMPONENTS v = velocity.rgb;
  COMPONENTS gn = gain.rgb;
  #else
  #define COMPONENTS vec2
  COMPONENTS f = force.rg;
  COMPONENTS v = velocity.rg;
  COMPONENTS gn = gain.rg;
  #endif

  // Jacobs' rule in force terms: a gain grows on axes where the force still
  // pushes the way the point is already moving (descent continues) and decays
  // where they oppose (the previous step overshot and the force reversed).
  COMPONENTS grow = COMPONENTS(greaterThan(f * v, COMPONENTS(0.0)));
  gn = max(grow * (gn + 0.2) + (1.0 - grow) * (gn * 0.8), COMPONENTS(minGain));
  COMPONENTS vNext = momentum * v + learningRate * gn * f;

  COMPONENTS result = writeGain > 0.5 ? gn : vNext;
  #ifdef SPACE_3D
  fragColor = vec4(result, 0.0);
  #else
  fragColor = vec4(result, 0.0, 0.0);
  #endif
}
