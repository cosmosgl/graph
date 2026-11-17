import productionFragment from '../../../../../src/modules/Lines/draw-curve-line.frag?raw'
import { patternShader } from './patterns'

// Separate unblended float programs. These capture diagnostic intermediates;
// they never replace ordinary color/ID entry points or CPU expectations.
export function patternProbeGL (probe: number): string {
  const replace = (source: string, before: string, after: string): string => {
    if (source.split(before).length !== 2) throw new Error('Production pattern probe location changed')
    return source.replace(before, after)
  }
  let source = replace(productionFragment, 'void main() {',
    'void main() {\nvec3 diagnosticPhase = vec3(0.0); vec4 diagnosticDot = vec4(0.0);')
  const phase = 'float phase = clamp(pos.x, 0.0, 1.0) * vLinkDashSpan;'
  source = replace(source, phase, `${phase}\ndiagnosticPhase = vec3(phase,dFdx(phase),dFdy(phase));`)
  const radius = 'float r = length(vec2(localX, localY));'
  source = replace(source, radius, `${radius}\ndiagnosticDot = vec4(r,dFdx(r),dFdy(r),diameter);`)
  const output = probe === 4 ? 'vec4(diagnosticPhase,coverage)' : probe === 5 ? 'diagnosticDot' : 'vec4(pos,smoothing,vLinkDashWidth)'
  return replace(source, 'float opacity = rgbaColor.a * coverage;', `fragColor = ${output}; return;\nfloat opacity = rgbaColor.a * coverage;`)
}

export function patternProbeGPU (source: string, curved: boolean, probe: number): string {
  const decorated = patternShader(source, curved)
  const start = decorated.indexOf('fn patternMask(input: Vertex) -> f32 {')
  if (start < 0) throw new Error('Pattern diagnostic composition changed')
  const result = 'select(select(1.0,dash,input.stroke == 1u),dot,input.stroke == 2u)'
  const output = probe === 4 || probe >= 7
    ? `vec4f(phase,phaseDx,phaseDy,${result} * smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y)))`
    : probe === 5 ? 'vec4f(radius,dpdx(radius),dpdy(radius),diameter)' : 'vec4f(input.coord,input.smoothing,input.pattern.y)'
  let diagnostic = decorated.slice(start)
    .replace('fn patternMask(input: Vertex) -> f32', '@fragment fn patternProbe(input: Vertex) -> @location(0) vec4f')
    .replace(`return ${result};`, `return ${output};`)
  if (probe >= 7) {
    const suffix = probe === 7 ? 'Fine' : 'Coarse'
    diagnostic = diagnostic.replaceAll('dpdx(', `dpdx${suffix}(`).replaceAll('dpdy(', `dpdy${suffix}(`)
      .replaceAll('fwidth(', `fwidth${suffix}(`)
  }
  return `${decorated}\n${diagnostic}`
}
