import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { DEFAULTS, fixture } from './data'
import { compare } from './reference'
import { runSweep } from './study'
import { gradientScene } from './gradient-fixtures'
import { checkGradientContract } from './gradient-contract'

it('preserves endpoint RGB, default channels, picking and the solid control', async () => {
  const webgl = await createLinksWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    webgpu = await createLinksWebGPU(document.createElement('canvas'))
    for (const backend of [webgl, webgpu]) {
      await checkGradientContract(fixture('ribbons'), DEFAULTS, async (scene, settings) =>
        await backend.render(scene, settings, 'visible', false))
    }
    for (const preset of ['defaults', 'endpoint-alpha'] as const) {
      const input = gradientScene(fixture('ribbons'), preset)
      const configuration = { ...DEFAULTS, endpointColors: true, pointDefaultColor: [0.25, 0.6, 0.8, 0] as [number, number, number, number] }
      const a = await webgl.render(input, configuration, 'visible', false)
      const b = await webgpu.render(input, configuration, 'visible', false)
      const result = await compare(a, b, input, configuration)
      expect(result.colors.budgetFailures, JSON.stringify(result)).toBe(0)
      expect(result.cpuColors.webgl.budgetFailures, JSON.stringify(result)).toBe(0)
      expect(result.cpuColors.webgpu.budgetFailures, JSON.stringify(result)).toBe(0)
    }
    const scene = gradientScene(fixture('ribbons'), 'endpoints'); const settings = { ...DEFAULTS, endpointColors: true }
    const a = await webgl.render(scene, settings, 'visible', false); const b = await webgpu.render(scene, settings, 'visible', false)
    const result = await compare(a, b, scene, settings)
    expect(result, JSON.stringify(result)).toMatchObject({ passed: true })
    // The first horizontal ribbon spans x=40..220 at y=48. Both ends must differ.
    for (const image of [a, b]) {
      const left = (48 * image.width + 60) * 4; const right = (48 * image.width + 200) * 4
      expect(image.color[left]).toBeGreaterThan(image.color[left + 2])
      expect(image.color[right + 2]).toBeGreaterThan(image.color[right])
    }
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 120000)

it('records the endpoint-gradient matrix with unchanged full-frame gates', async () => {
  const webgl = await createLinksWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    webgpu = await createLinksWebGPU(document.createElement('canvas'))
    const solidRows = await runSweep({ webgl, webgpu }, () => {}, () => false)
    const rows = await runSweep({ webgl, webgpu }, () => {}, () => false, 'endpoints')
    await writeArtifact('straight-link-endpoint-gradients', {
      browser: navigator.userAgent, devices: { webgl: webgl.info, webgpu: webgpu.info }, solidRows, rows,
    })
    expect(rows).toHaveLength(40)
    expect(rows.every(r => r.preservation.webgl.changedPixels === 0 && r.preservation.webgpu.changedPixels === 0)).toBe(true)
    expect(rows.map(r => [r.passed, r.candidate.idDifferences, r.candidate.masks]))
      .toEqual(solidRows.map(r => [r.passed, r.candidate.idDifferences, r.candidate.masks]))
    // Completing the investigation is not accepting the geometry's rejected rows.
    expect(rows.some(r => !r.passed)).toBe(true)
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 300000)
