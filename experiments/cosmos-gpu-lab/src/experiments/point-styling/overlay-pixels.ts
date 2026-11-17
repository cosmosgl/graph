// Separate lab candidate: keep the original shaders and their compiled controls intact.
function replace (source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('Overlay shader changed; review the pixel-distance candidate')
  return source.replace(before, after)
}

export function pixelOverlayGLSL (vertex: string, fragment: string): { vertex: string; fragment: string } {
  vertex = replace(vertex, 'flat out float quadHalfPx;', 'flat out float quadHalfPx;\nflat out vec2 overlayCenterPx;')
  vertex = replace(vertex, 'gl_Position = vec4(final.rg, 0, 1);', `gl_Position = vec4(final.rg, 0, 1);
  // Lab camera is a scale about the viewport centre. WebGL has a bottom-left origin.
  overlayCenterPx = ((a - worldOrigin) * transformationMatrix[0][0] + screenSize * 0.5) * pixelRatio;`)
  fragment = replace(fragment, 'flat in float quadHalfPx;', 'flat in float quadHalfPx;\nflat in vec2 overlayCenterPx;')
  fragment = replace(fragment, 'length(vertexPosition) * quadHalfPx', 'length(gl_FragCoord.xy - overlayCenterPx)')
  return { vertex, fragment }
}

export function pixelOverlayWGSL (source: string): string {
  source = replace(source, '@location(3) @interpolate(flat) color: vec4f,',
    '@location(3) @interpolate(flat) color: vec4f,\n  @location(4) @interpolate(flat) center: vec2f,')
  source = replace(source, 'result.coord = corners[vertex]; result.radius = radius;',
    'result.center = center; result.coord = corners[vertex]; result.radius = radius;')
  return replace(source, 'length(input.coord) * input.halfSize', 'length(input.position.xy - input.center)')
}
