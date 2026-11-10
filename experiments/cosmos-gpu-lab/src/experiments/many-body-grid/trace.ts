import { compareArray, TOLERANCE, type Check } from '../many-body/reference'
import { layout } from './data'
export type Trace = Record<string, Float32Array>
export function stageNames (count: number): string[] {
  return [...layout(count).sizes.map(n => `far ${n}`), 'near raw', 'near jitter', 'near clamped']
}
export function createTrace (count: number): Trace {
  return Object.fromEntries(stageNames(count).map(name => [name, new Float32Array(count * 4)]))
}
export function replaceOnce (source: string, anchor: string, replacement: string): string {
  if (source.split(anchor).length !== 2) throw new Error(`Diagnostic shader anchor changed: ${anchor}`)
  return source.replace(anchor, replacement)
}
export function nearTraceShader (source: string, stage: 'raw' | 'jitter'): string {
  const anchor = stage === 'raw' ? '  velocity += velocity * random.rg;' : '  float speed = length(velocity);'
  return replaceOnce(source, anchor, `  fragColor = vec4(velocity, 0.0, 0.0); return;\n${anchor}`)
}
export function gpuTraceShader (source: string): string {
  let s = `${source}\n@group(0) @binding(10) var<storage, read_write> trace: array<vec4<f32>>;\n`
  s = replaceOnce(s, '    far += velocity;', '    far += velocity;\n    trace[level * u32(params.count) + targetIndex] = vec4(far, 0., 0.);')
  s = replaceOnce(s, '  near += near * randomDir;', `  let base = u32(params.levelCount) * u32(params.count) + targetIndex;
  trace[base] = vec4(near, 0., 0.);
  near += near * randomDir;
  trace[base + u32(params.count)] = vec4(near, 0., 0.);`)
  return replaceOnce(s, '  forces[targetIndex] = vec4(far + near, 0., 0.);', `  trace[base + 2u * u32(params.count)] = vec4(near, 0., 0.);
  forces[targetIndex] = vec4(far + near, 0., 0.);`)
}
export type StageCheck = {
  stage: string; check: Check; worst: { point: number; axis: string; actual: number; expected: number; error: number; budget: number; ratio: number } | null;
}
export function traceChecks (actual: Trace, expected: Trace, points: Float32Array): StageCheck[] {
  return Object.entries(expected).map(([stage, reference]) => {
    const a = actual[stage]?.slice() ?? new Float32Array(); const b = reference.slice()
    for (let i = 0; i < points.length; i += 4) {
      if (points[i + 3] > 0.5) { a.fill(0, i, i + 4); b.fill(0, i, i + 4) }
    }
    const check = compareArray(a, b)
    let worst: StageCheck['worst'] = null
    for (const [i, element] of b.entries()) {
      if (i % 4 >= 2 || points[Math.floor(i / 4) * 4 + 3] > 0.5) continue
      const error = Number.isFinite(a[i]) ? Math.abs(a[i] - element) : Infinity
      const budget = TOLERANCE.absolute + TOLERANCE.relative * Math.abs(element); const ratio = error / budget
      if (!worst || ratio > worst.ratio) worst = { point: Math.floor(i / 4), axis: i % 4 ? 'y' : 'x', actual: a[i], expected: element, error, budget, ratio }
    }
    return { stage, check, worst }
  })
}
