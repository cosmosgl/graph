import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { DEFAULTS } from './data'
import { compare } from './reference'
import { replayFaintAlpha } from './faint-alpha'

it('replays faint straight-link source visibility without changing original colors or full-frame gates', async () => {
  const webgl = await createLinksWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    webgpu = await createLinksWebGPU(document.createElement('canvas'))
    const backends = { webgl, webgpu }
    const rows = await replayFaintAlpha({
      curve: false,
      defaults: DEFAULTS,
      compare,
      render: async (lane, scene, settings, candidate) => await backends[lane].render(scene, settings, candidate ? 'visible' : 'production', false),
    })
    await writeArtifact('straight-link-faint-alpha', {
      browser: navigator.userAgent,
      devices: { webgl: webgl.info, webgpu: webgpu.info },
      candidate: 'visible',
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
    // This assertion is the focused visibility gate, not whole-frame acceptance.
    // Every original CPU/mask/color verdict remains in the capture.
    const failures = rows.filter(r => r.lanes.some(l => l.candidateSource.invisible) || r.candidate.invisible.webgl || r.candidate.invisible.webgpu)
    expect(failures, JSON.stringify(failures)).toEqual([])
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 300000)
