import { expect, it } from 'vitest'
import { pick } from '../../gpu/rgba-readback'
import { writeArtifact } from '../../testing/artifacts'
import { patternCoverage, type PatternGeometry } from '../straight-links/patterns'
import { fixture as straightFixture } from '../straight-links/data'
import { ribbons } from '../straight-links/reference'
import { createLinksWebGL } from '../straight-links/webgl'
import { createLinksWebGPU } from '../straight-links/webgpu'
import { DEFAULTS, fixture } from './data'
import { mesh } from './reference'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'

function cpuSample (g: PatternGeometry, x: number, y: number): object {
  const coords = g.coords(x + 0.5, y + 0.5)
  const phase = (px: number, py: number): number => Math.max(0, Math.min(1, g.coords(px, py)[0])) * g.span
  const left = Math.floor(x / 2) * 2 + 0.5; const top = Math.floor(y / 2) * 2 + 0.5
  const dx = phase(left + 1, y + 0.5) - phase(left, y + 0.5)
  const dy = phase(x + 0.5, top + 1) - phase(x + 0.5, top)
  const ramp = Math.max(0, Math.min(1, (0.5 - Math.abs(coords[1])) / g.smoothing))
  return {
    coords,
    phase: phase(x + 0.5, y + 0.5),
    dx,
    dy,
    smoothing: g.smoothing,
    width: g.width,
    coverage: ramp * ramp * (3 - 2 * ramp) * patternCoverage(g, DEFAULTS, x + 0.5, y + 0.5),
  }
}

it('captures pattern boundary intermediates without changing ordinary color or IDs', async () => {
  const rows = []
  for (const kind of ['straight', 'curved'] as const) {
    const gl = await (kind === 'straight' ? createLinksWebGL : createCurvesWebGL)(document.createElement('canvas'))
    let gpu: Awaited<ReturnType<typeof createLinksWebGPU>> | Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
    try {
      gpu = await (kind === 'straight' ? createLinksWebGPU : createCurvesWebGPU)(document.createElement('canvas'))
      const original = kind === 'straight' ? straightFixture('ribbons') : fixture('bows')
      const cases = kind === 'straight'
        ? [{ pattern: 'dashed' as const, source: 1, x: 40, y: 96 }]
        : [{ pattern: 'dashed' as const, source: 0, x: 135, y: 79 },
          { pattern: 'dotted' as const, source: 0, x: 121, y: 79 },
          { pattern: 'dotted' as const, source: 0, x: 43, y: 118 }]
      for (const entry of cases) {
        const scene = { ...original, links: [original.links[entry.source]] }
        const settings = { ...DEFAULTS, pattern: entry.pattern }
        const cpu = kind === 'straight'
          ? [cpuSample(ribbons(scene, settings, false, 'visible')[0].pattern!, entry.x, entry.y)]
          : mesh(scene, settings, false, 'front').filter(t => {
            if (t.area >= 0) return false
            const [a, b, c] = t.vertices.map(v => v.xy); const p = [entry.x + 0.5, entry.y + 0.5]
            const edge = (a: number[], b: number[]): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
            return [edge(a, b), edge(b, c), edge(c, a)].every(e => e <= 0)
          }).map(t => cpuSample(t.pattern!, entry.x, entry.y))
        expect(cpu.length).toBeGreaterThan(0)
        for (const [lane, backend] of [['webgl', gl], ['webgpu', gpu]] as const) {
          // 'visible' has identical color geometry in both adapters. Each source is isolated.
          const before = await backend.render(scene, settings, 'visible', false)
          const captured = await backend.render(scene, settings, 'visible', false, true)
          const after = await backend.render(scene, settings, 'visible', false)
          expect(captured.color).toEqual(before.color); expect(captured.ids).toEqual(before.ids)
          expect(after.color).toEqual(before.color); expect(after.ids).toEqual(before.ids)
          expect(captured.probe?.pattern).toHaveLength(lane === 'webgl' ? 3 : 5)
          const samples = []
          for (let y = entry.y & ~1; y < (entry.y & ~1) + 2; y++) {
            for (let x = entry.x & ~1; x < (entry.x & ~1) + 2; x++) {
              const offset = (y * captured.width + x) * 4
              samples.push({
                x,
                y,
                id: pick(captured, x, y),
                rgba: Array.from(captured.color.slice(offset, offset + 4)),
                phase: Array.from(captured.probe!.pattern![0].slice(offset, offset + 4)),
                dot: Array.from(captured.probe!.pattern![1].slice(offset, offset + 4)),
                geometry: Array.from(captured.probe!.pattern![2].slice(offset, offset + 4)),
                fine: captured.probe!.pattern![3] ? Array.from(captured.probe!.pattern![3].slice(offset, offset + 4)) : undefined,
                coarse: captured.probe!.pattern![4] ? Array.from(captured.probe!.pattern![4].slice(offset, offset + 4)) : undefined,
              })
            }
          }
          const witness = samples.find(s => s.x === entry.x && s.y === entry.y)!
          expect(witness.geometry[2]).toBeGreaterThan(0)
          expect(witness.phase.every(Number.isFinite)).toBe(true)
          rows.push({ kind, ...entry, lane, device: backend.info, cpu, samples })
        }
      }
    } finally { gpu?.destroy(); gl.destroy() }
  }
  await writeArtifact('link-pattern-boundaries', { browser: navigator.userAgent, rows })
}, 180000)
