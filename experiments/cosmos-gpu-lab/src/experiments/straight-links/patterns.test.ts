import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { pick } from '../../gpu/rgba-readback'
import { DEFAULTS, fixture } from './data'
import { compare } from './reference'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { replayPatterns } from './pattern-study'

it('compares dash/dot paint and visible-pixel picking while retaining production gap picking', async () => {
  const webgl = await createLinksWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    webgpu = await createLinksWebGPU(document.createElement('canvas')); const backends = { webgl, webgpu }
    const rows = await replayPatterns({
      defaults: DEFAULTS,
      scenes: { ribbons: fixture('ribbons'), overlap: fixture('overlap') },
      compare,
      render: async (lane, scene, settings, candidate) => await backends[lane].render(scene, settings, candidate ? 'visible' : 'production', false),
    })
    await writeArtifact('straight-link-patterns', { browser: navigator.userAgent, devices: { webgl: webgl.info, webgpu: webgpu.info }, rows })
    expect(rows).toHaveLength(24)
    expect(rows.filter(r => r.preservation.webgl.changedPixels || r.preservation.webgpu.changedPixels)).toEqual([])
    for (const backend of [webgl, webgpu]) {
      const baseline = await backend.render(fixture('ribbons'), DEFAULTS, 'visible', false)
      for (const [pattern, x] of [['dashed', 47], ['dotted', 53]] as const) {
        const settings = { ...DEFAULTS, pattern }
        const control = await backend.render(fixture('ribbons'), settings, 'production', false)
        const candidate = await backend.render(fixture('ribbons'), settings, 'visible', false)
        expect(pick(control, x, 154)).toBe(2)
        expect(control.color[(154 * control.width + x) * 4 + 3]).toBe(0)
        expect(pick(candidate, x, 154)).toBeNull()
      }
      const restored = await backend.render(fixture('ribbons'), DEFAULTS, 'visible', false)
      expect(restored.color).toEqual(baseline.color); expect(restored.ids).toEqual(baseline.ids)
    }
    expect(rows.filter(r => r.candidate.invisible.webgl || r.candidate.invisible.webgpu || r.sources.webgl || r.sources.webgpu)).toEqual([])
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 300000)
