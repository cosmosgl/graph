import { pick, type Snapshot } from './backend'
import { center, diameter, SHAPES, type Point, type Settings } from './data'
import { prepareReferencePick, shapeDistance } from './reference'
import { spriteDiameter } from './point-effects'

// Exact dyadic arithmetic for the mathematical diamond only. This diagnostic
// NEVER supplies an expected ID to the existing scalar acceptance reference.
export function exactDiamondSide (x: number, y: number, core: number): number {
  if (![x, y, core].every(Number.isFinite) || core <= 0) throw new Error('Finite coordinates and a positive core are required')
  const view = new DataView(new ArrayBuffer(8))
  const dyadic = (value: number): { mantissa: bigint; exponent: number } => {
    view.setFloat64(0, Math.abs(value)); const bits = view.getBigUint64(0)
    const e = Number((bits >> 52n) & 2047n)
    return { mantissa: (bits & ((1n << 52n) - 1n)) | (e ? 1n << 52n : 0n), exponent: (e || 1) - 1023 - 52 }
  }
  const terms = [x, y, core].map(dyadic); const coefficients = [30n, 25n, -12n]
  const exponent = Math.min(...terms.map(t => t.exponent))
  const result = terms.reduce((sum, t, i) => sum + coefficients[i] * (t.mantissa << BigInt(t.exponent - exponent)), 0n)
  return result === 0n ? 0 : result < 0n ? -1 : 1
}
export type PolygonSample = {
  x: number; y: number; point: number; shape: number; expected: number | null; webgl: number | null; webgpu: number | null;
  cpuDistance: number; exactDiamondSide?: number; webglCore: number[]; webgpuCore: number[];
  webglDistance: number; webgpuDistance: number; webglCoverage: number; webgpuCoverage: number;
}
export type PolygonAudit = { arithmetic: 'normalized' | 'pixels'; samples: PolygonSample[] }
export function auditPolygons (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings): PolygonAudit {
  if (!gl.probe || !gpu.probe) throw new Error('Polygon audit requires the public-luma float probes')
  const expectedAt = prepareReferencePick(points, settings, gl.pickingRule)
  const samples: PolygonSample[] = []
  for (let y = 0; y < gl.height; y++) {
    for (let x = 0; x < gl.width; x++) {
      const expected = expectedAt(x + 0.5, y + 0.5); const webgl = pick(gl, x, y); const webgpu = pick(gpu, x, y)
      if (webgl === expected && webgpu === expected) continue
      // This audit is for the disjoint aligned-shape fixture. Match the point's
      // carrier, not a hardcoded pixel list or a distance tolerance.
      const point = points.findIndex(p => {
        const [cx, cy] = center(p, settings); const half = spriteDiameter(p, settings) * 0.5
        return Math.abs(x + 0.5 - cx) <= half && Math.abs(y + 0.5 - cy) <= half
      })
      if (point < 0) throw new Error('Rejected pixel is outside every diagnostic carrier')
      const p = points[point]; const [cx, cy] = center(p, settings); const core = Math.max(diameter(p, settings), 1)
      const dx = x + 0.5 - cx; const dy = y + 0.5 - cy; const index = (y * gl.width + x) * 4
      const a = gl.probe.edge; const b = gpu.probe.edge
      samples.push({
        x,
        y,
        point,
        shape: p.shape,
        expected,
        webgl,
        webgpu,
        cpuDistance: shapeDistance(dx * 2 / core, dy * 2 / core, p.shape) * core * 0.5,
        exactDiamondSide: p.shape === 3 ? exactDiamondSide(dx, dy, core) : undefined,
        webglCore: Array.from(a.subarray(index, index + 2)),
        webgpuCore: Array.from(b.subarray(index, index + 2)),
        webglDistance: a[index + 2],
        webgpuDistance: b[index + 2],
        webglCoverage: a[index + 3],
        webgpuCoverage: b[index + 3],
      })
    }
  }
  return { arithmetic: gl.polygonArithmetic ?? 'normalized', samples }
}
export function renderPolygonAudit (host: HTMLElement, audit: PolygonAudit): void {
  const id = (value: number | null): string => value === null ? 'Background' : String(value)
  const value = (n: number): string => n === 0 ? '0' : n.toExponential(4)
  host.insertAdjacentHTML('beforeend', `<h3>Polygon boundary replay</h3>
    <p>${audit.arithmetic === 'pixels' ? 'Pixel-space diagnostic' : 'Normalized control'} · ${audit.samples.length} rejected pixel positions.
      All pixels still use the unchanged CPU mask and 2/255 gate. Exact diamond side is a separate diagnostic:
      zero means a mathematical edge; it never overrides acceptance.</p>
    <table data-polygon-audit><thead><tr><th>Pixel / shape / point</th><th>IDs · CPU / GL / GPU</th>
      <th>Distance px · CPU / GL / GPU</th><th>Coverage · GL / GPU</th><th>Exact diamond side</th></tr></thead><tbody>
    ${audit.samples.map(s => `<tr><td>(${s.x}, ${s.y}) · ${SHAPES[s.shape]} · ${s.point}</td>
      <td>${id(s.expected)} / ${id(s.webgl)} / ${id(s.webgpu)}</td>
      <td>${value(s.cpuDistance)} / ${value(s.webglDistance)} / ${value(s.webgpuDistance)}</td>
      <td>${s.webglCoverage.toFixed(8)} / ${s.webgpuCoverage.toFixed(8)}</td>
      <td>${s.exactDiamondSide ?? '—'}</td></tr>`).join('')}</tbody></table>`)
}
