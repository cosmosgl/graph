import type { Parameters } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { cellOf, layout, type Frame, type Structure } from './data'
import { replaceOnce } from './trace'
const f = Math.fround
// A diagnostic replay, not a capture of registers from the ordinary pipeline.
// Four vec4s per candidate, at most 100 candidates per hierarchy level.
export function contributionShader (source: string): string {
  let s = `${source}\n@group(0) @binding(10) var<storage, read_write> contributions: array<vec4<f32>>;\n`
  s = replaceOnce(s, 'let targetIndex = gid.x;', 'if (gid.x != 0u) { return; } let targetIndex = u32(params.pad0);')
  const refined = source.includes('fn roundedSquare(')
  const magnitude = refined ? 'refinedDivide(params.alpha * params.repulsion * a.z, denominator)' : 'params.alpha * params.repulsion * a.z / denominator'
  const pairName = source.includes('fn farPairVelocity(') ? 'farPairVelocity' : 'pairVelocity'
  const call = `if (a.z > 0.) { velocity += ${pairName}(point.xy - centroids[cellIndex].xy, vec2(0.), a.z); }`
  s = replaceOnce(s, call, `if (a.z > 0.) {
        let delta = point.xy - centroids[cellIndex].xy;
        let contribution = ${pairName}(delta, vec2(0.), a.z);
        velocity += contribution;
        let row = (level * 100u + u32(j * width + i)) * 4u;
        let squared = ${refined ? 'roundedSquare(delta.x) + roundedSquare(delta.y)' : 'dot(delta, delta)'};
        let root = ${refined ? 'refinedRoot(squared)' : 'sqrt(squared)'};
        let denominator = select(root, ${refined ? 'refinedRoot(root)' : 'sqrt(root)'}, squared < 1.);
        let magnitude = ${magnitude};
        contributions[row] = vec4(delta, a.z, f32(cellIndex));
        contributions[row + 1u] = vec4(squared, root, denominator, magnitude);
        contributions[row + 2u] = vec4(${refined ? 'vec2(refinedDivide(delta.x, root), refinedDivide(delta.y, root))' : 'normalize(delta)'}, contribution);
        contributions[row + 3u] = vec4(velocity, far);
      }`)
  return s
}
export type ContributionRow = {
  grid: number; cell: number; mass: number;
  gpu: number[]; cpu: number[];
}
export type ContributionReport = {
  target: number; replay: ReturnType<typeof compareArray>;
  rows: ContributionRow[];
  summary: Array<{ stage: string; differing: number; maxError: number }>;
}
export function compareContributions (
  data: Float32Array, target: number, points: Float32Array, p: Parameters, frame: Frame,
  structure: Structure, centers: Float32Array, replay: Float32Array, normal: Float32Array
): ContributionReport {
  const l = layout(points.length / 4); const rows: ContributionRow[] = []
  let far = [0, 0]
  for (const [level, n] of l.sizes.entries()) {
    const key = cellOf(points[target * 4], points[target * 4 + 1], n, frame.bounds)
    const cx = key % n; const cy = Math.floor(key / n)
    const parent = frame.precise ? 2 : 1
    const shell = frame.precise && level < l.sizes.length - 1 ? 2 : 1
    const width = level ? 2 * (2 * parent + 1) : n
    const bx = level ? Math.floor(cx / 2) * 2 - 2 * parent : 0
    const by = level ? Math.floor(cy / 2) * 2 - 2 * parent : 0
    let prefix = [0, 0]
    for (let j = 0; j < width; j++) {
      for (let i = 0; i < width; i++) {
        const x = bx + i; const y = by + j
        if (x < 0 || y < 0 || x >= n || y >= n || Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= shell) continue
        const cell = l.offsets[level] + y * n + x; const mass = structure.aggregates[cell * 4 + 2]
        if (!mass) continue
        const dx = f(points[target * 4] - centers[cell * 4]); const dy = f(points[target * 4 + 1] - centers[cell * 4 + 1])
        const squared = f(f(dx * dx) + f(dy * dy)); const length = f(Math.sqrt(squared))
        const denominator = f(Math.sqrt(squared < 1 ? length : squared))
        const magnitude = f(f(f(f(p.alpha) * f(p.repulsion)) * mass) / denominator)
        const direction = squared > 0 ? [f(dx / length), f(dy / length)] : [0, 0]
        const force = direction.map(v => f(magnitude * v))
        prefix = prefix.map((v, axis) => f(v + force[axis]))
        const offset = (level * 100 + j * width + i) * 16
        rows.push({
          grid: n,
          cell,
          mass,
          gpu: Array.from(data.slice(offset, offset + 16)),
          cpu: [dx, dy, mass, cell, squared, length, denominator, magnitude, ...direction, ...force, ...prefix, ...far],
        })
      }
    }
    far = far.map((v, axis) => f(v + prefix[axis]))
  }
  const fields: Array<[string, number[]]> = [
    ['delta', [0, 1]], ['cell / mass', [2, 3]], ['squared distance', [4]], ['length', [5]],
    ['softened denominator', [6]], ['magnitude', [7]], ['direction', [8, 9]], ['contribution', [10, 11]],
    ['level prefix', [12, 13]], ['prior far sum', [14, 15]],
  ]
  return {
    target,
    replay: compareArray(replay.slice(target * 4, target * 4 + 2), normal.slice(target * 4, target * 4 + 2)),
    rows,
    summary: fields.map(([stage, indices]) => {
      const errors = rows.filter(r => r.grid === 128).flatMap(r => indices.map(i => Math.abs(r.gpu[i] - r.cpu[i])))
      return { stage, differing: errors.filter(e => e !== 0).length, maxError: Math.max(0, ...errors) }
    }),
  }
}
