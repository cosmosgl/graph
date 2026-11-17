import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { effectsCpuColors } from './effects-reference'
import { effectScenario } from './effects-fixtures'

it('preserves IDs, pick-only colors and production controls when switching overlay arithmetic', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const rows = []
    for (const ratio of [1, 2]) {
      for (const zoom of [0.5, 2]) {
        for (const scaleOnZoom of [true, false]) {
          const scene = effectScenario('overlap', 0, { ratio, zoom, scaleOnZoom })
          const points = scene.points.map((p, i) => ({ ...p, x: p.x + 0.125 * (i + 1), y: p.y - 0.25, size: p.size + 0.375 }))
          const settings = { ...scene.settings, overlayArithmetic: 'pixels' as const }
          for (const backend of [gl, gpu]) {
            const original = await backend.render(points, scene.settings, false, 'production', false)
            const explicit = await backend.render(points, settings, false, 'explicit', false)
            const candidate = await backend.render(points, settings, false, 'eligibility', false)
            const base = await backend.render(points, { ...settings, hovered: [], focused: undefined }, false, 'eligibility', false)
            const deduplicated = await backend.render(points, { ...settings, hovered: [0, 1] }, false, 'eligibility', false)
            const restored = await backend.render(points, settings, false, 'production', false)
            rows.push({
              device: backend.info,
              ratio,
              zoom,
              scaleOnZoom,
              cpu: effectsCpuColors(candidate, points, settings),
              idsUnchanged: candidate.ids.every((v, i) => v === base.ids[i]),
              pickOnlyColors: candidate.color.every((v, i) => v === explicit.color[i]),
              deduplicated: candidate.color.every((v, i) => v === deduplicated.color[i]),
              productionColors: original.color.every((v, i) => v === restored.color[i]),
              productionIds: original.ids.every((v, i) => v === restored.ids[i]),
              candidateMode: candidate.overlayArithmetic,
              productionMode: restored.overlayArithmetic,
            })
          }
        }
      }
    }
    await writeArtifact('pixel-distance-overlay-contracts', { rows })
    expect(rows.filter(r => r.cpu.budgetFailures), JSON.stringify(rows)).toEqual([])
    expect(rows.every(r => r.idsUnchanged && r.pickOnlyColors && r.deduplicated && r.productionColors && r.productionIds)).toBe(true)
    expect(rows.every(r => r.candidateMode === 'pixels' && r.productionMode === 'normalized')).toBe(true)
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
