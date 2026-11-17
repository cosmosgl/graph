import { expect, it } from 'vitest'
import { pick } from '../../gpu/rgba-readback'
import { writeArtifact } from '../../testing/artifacts'
import { DEFAULTS, fixture } from './data'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { compareColors } from './reference'
import { PATTERN_PROFILES } from './pattern-study'

it('records native dash-wrap witnesses without substituting their verdict for acceptance', async () => {
  const webgl = await createLinksWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    webgpu = await createLinksWebGPU(document.createElement('canvas'))
    const original = fixture('overlap')
    const settings = { ...DEFAULTS, pattern: 'dashed' as const, zoom: 2, scaleOnZoom: false, dashLength: 7.5, dashGap: 3.25 }
    const rows = []
    for (const history of ['fresh', 'after style switches'] as const) {
      if (history === 'after style switches') {
        for (const profile of PATTERN_PROFILES) {
          for (const backend of [webgl, webgpu]) {
            await backend.render(fixture('ribbons'), { ...DEFAULTS, ...profile.settings, pattern: 'dotted' }, 'visible', false)
          }
        }
      }
      for (const shift of [0, -1 / 1024, 1 / 1024]) {
        const scene = { ...original, points: original.points.map(p => ({ ...p, x: p.x + shift / settings.zoom })) }
        for (const [lane, backend] of [['webgl', webgl], ['webgpu', webgpu]] as const) {
          const painted = await backend.render(scene, settings, 'production', false)
          const picked = await backend.render(scene, settings, 'visible', false)
          const witnesses = []
          for (let y = 0; y < painted.height; y++) {
            for (let x = 0; x < painted.width; x++) {
              const id = pick(picked, x, y); const offset = (y * painted.width + x) * 4
              if (id === null || painted.color[offset + 3] !== 0) continue
              const link = scene.links[id]; const a = scene.points[link.source]; const b = scene.points[link.target]
              const ax = (a.x - 256) * settings.zoom + 256; const ay = (a.y - 160) * settings.zoom + 160
              const dx = (b.x - a.x) * settings.zoom; const dy = (b.y - a.y) * settings.zoom; const span = Math.hypot(dx, dy)
              const phase = ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / span
              const period = settings.dashLength + settings.dashGap
              witnesses.push({
                x,
                y,
                id,
                rgba: Array.from(painted.color.slice(offset, offset + 4)),
                idealPhase: phase,
                idealRemainder: phase - Math.floor(phase / period) * period,
              })
            }
          }
          rows.push({ history, lane, shiftDevicePixels: shift, witnesses, unchangedColor: compareColors(painted.color, picked.color) })
        }
      }
    }
    await writeArtifact('straight-link-dash-wrap', { browser: navigator.userAgent, devices: { webgl: webgl.info, webgpu: webgpu.info }, settings, rows })
    expect(rows.every(r => r.unchangedColor.changedPixels === 0)).toBe(true)
    // Repeatability is a gate too: the unchanged source visibility rule applies
    // on fresh devices and after style/mode changes. No mask/color gate is waived.
    expect(rows.filter(r => r.witnesses.length > 0), JSON.stringify(rows)).toEqual([])
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 120000)
