import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { replayFaintAlpha } from '../straight-links/faint-alpha'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'
import { DEFAULTS, type Settings } from './data'
import type { Snapshot } from './backend'
import { compare, reference } from './reference'

it('replays faint curved-link source visibility without changing original colors or full-frame gates', async () => {
  const webgl = await createCurvesWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    webgpu = await createCurvesWebGPU(document.createElement('canvas'))
    const backends = { webgl, webgpu }
    const rows = await replayFaintAlpha<Settings, Snapshot>({
      curve: true,
      defaults: DEFAULTS,
      compare: async (a, b, scene, settings) => await compare(a, b, reference(scene, settings)),
      render: async (lane, scene, settings, candidate) => await backends[lane].render(scene, settings, candidate ? 'front' : 'production', false),
    })
    await writeArtifact('curved-link-faint-alpha', {
      browser: navigator.userAgent,
      devices: { webgl: webgl.info, webgpu: webgpu.info },
      candidate: 'front',
      rows,
    })
    expect(rows).toHaveLength(72)
    // Non-vacuous interior probes: eligible sources must actually be selected,
    // and an invisible source must fall through to the original background ID.
    for (const row of rows.filter(r => r.entry.opacity === 1 && r.entry.ratio === 1 && !r.entry.reverse &&
      ['below', 'boundary', 'above'].includes(r.entry.name))) {
      const expected = row.fullCoveragePredictedByte > 0 ? 1 : row.entry.overlap ? 0 : null
      expect(row.lanes.map(l => l.probe.candidateId), JSON.stringify(row.entry)).toEqual([expected, expected])
    }
    expect(rows.filter(r => r.entry.opacity === 0).every(r => r.lanes.every(l => l.probe.candidateId === null))).toBe(true)
    expect(rows.flatMap(r => r.lanes).filter(l => l.preservation.changedPixels)).toEqual([])
    const failures = rows.filter(r => r.lanes.some(l => l.candidateSource.invisible) || r.candidate.invisible.webgl || r.candidate.invisible.webgpu)
    expect(failures, JSON.stringify(failures)).toEqual([])
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 300000)
