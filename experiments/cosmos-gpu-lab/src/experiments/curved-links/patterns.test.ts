import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { replayPatterns } from '../straight-links/pattern-study'
import { DEFAULTS, fixture, type Settings } from './data'
import type { Snapshot } from './backend'
import { compare, reference } from './reference'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'

it('compares patterned curves against production and independent CPU quads without accepting rejected pixels', async () => {
  const webgl = await createCurvesWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    webgpu = await createCurvesWebGPU(document.createElement('canvas')); const backends = { webgl, webgpu }
    const rows = await replayPatterns<Settings, Snapshot>({
      defaults: DEFAULTS,
      scenes: { bows: fixture('bows'), overlap: fixture('overlap') },
      compare: async (a, b, scene, settings) => await compare(a, b, reference(scene, settings)),
      render: async (lane, scene, settings, candidate) => await backends[lane].render(scene, settings, candidate ? 'front' : 'production', false),
    })
    await writeArtifact('curved-link-patterns', { browser: navigator.userAgent, devices: { webgl: webgl.info, webgpu: webgpu.info }, rows })
    expect(rows).toHaveLength(24)
    expect(rows.filter(r => r.preservation.webgl.changedPixels || r.preservation.webgpu.changedPixels)).toEqual([])
    expect(rows.filter(r => r.candidate.invisible.webgl || r.candidate.invisible.webgpu || r.sources.webgl || r.sources.webgpu)).toEqual([])
    expect(rows.filter(r => r.profile !== 'Hidden').every(r => r.production.invisible.webgl > 0 && r.production.invisible.webgpu > 0)).toBe(true)
    for (const backend of [webgl, webgpu]) {
      const baseline = await backend.render(fixture('bows'), DEFAULTS, 'front', false)
      await backend.render(fixture('bows'), { ...DEFAULTS, pattern: 'dotted' }, 'front', false)
      const restored = await backend.render(fixture('bows'), DEFAULTS, 'front', false)
      expect(restored.color).toEqual(baseline.color); expect(restored.ids).toEqual(baseline.ids)
    }
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 300000)
