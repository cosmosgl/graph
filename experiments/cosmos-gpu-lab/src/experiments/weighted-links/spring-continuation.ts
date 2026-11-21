import { replaceOnce } from '../many-body-grid/trace'

export const SPRING_NEIGHBORS_PER_PASS = 4096

// The first draw uses the same loop body and writes one force per point. Each
// later draw reads only the high-degree points and carries their exact partial
// velocity forward. The next neighbor depends on that velocity.
export function continueSpringShader (source: string): string {
  source = replaceOnce(source, 'precision highp float;', `precision highp float;
precision highp int;

uniform sampler2D continuationPoints;
uniform sampler2D previousForce;
layout(std140) uniform springContinuation {
  int neighborStart;
  int firstContinuation;
};`)
  source = replaceOnce(source, 'ivec2 pointTexel = ivec2(gl_FragCoord.xy);', `ivec2 continuationTexel = ivec2(gl_FragCoord.xy);
  vec4 mapping = texelFetch(continuationPoints, continuationTexel, 0);
  if (mapping.a == 0.0) { fragColor = vec4(0.0); return; }
  ivec2 pointTexel = ivec2(mapping.xy);`)
  source = replaceOnce(source, 'vec4 velocity = vec4(0.0);', `ivec2 previousTexel = firstContinuation == 1 ? pointTexel : continuationTexel;
  vec4 velocity = texelFetch(previousForce, previousTexel, 0);`)
  source = replaceOnce(source, 'float iCount = linkInfo.r;\n  float jCount = linkInfo.g;\n  float linkAmount = linkInfo.b;',
    `int column = int(linkInfo.r) + neighborStart;
  float iCount = float(column % int(linksTextureSize));
  float jCount = linkInfo.g + float(column / int(linksTextureSize));
  float linkAmount = linkInfo.b - float(neighborStart);`)
  return source
}

// Scatter the final partials into the original point texels. The surrounding
// render pass preserves the contributions already written for other points.
export const scatterContinuationVertex = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D continuationPoints;
uniform sampler2D previousForce;
uniform sampler2D positionsTexture;
flat out vec4 force;
void main() {
  int width = textureSize(continuationPoints, 0).x;
  ivec2 encodedTexel = ivec2(gl_VertexID % width, gl_VertexID / width);
  vec2 point = texelFetch(continuationPoints, encodedTexel, 0).xy;
  vec2 clip = (point + 0.5) * 2.0 / vec2(textureSize(positionsTexture, 0)) - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 1.0;
  force = texelFetch(previousForce, encodedTexel, 0);
}`

export const scatterContinuationFragment = `#version 300 es
precision highp float;
flat in vec4 force;
out vec4 fragColor;
void main() { fragColor = force; }`
