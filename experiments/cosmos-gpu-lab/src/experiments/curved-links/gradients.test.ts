import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { gradientScene } from '../straight-links/gradient-fixtures'
import { checkGradientContract } from '../straight-links/gradient-contract'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'
import { DEFAULTS, fixture } from './data'
import { compare, reference } from './reference'
import { runSweep } from './study'

it('preserves curved endpoint RGB, defaults, picking and the solid control', async () => {
  const webgl = await createCurvesWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    webgpu = await createCurvesWebGPU(document.createElement('canvas'))
    for (const backend of [webgl, webgpu]) {
      await checkGradientContract(fixture('bows'), DEFAULTS, async (scene, settings) =>
        await backend.render(scene, settings, 'front', false))
    }
    for (const preset of ['defaults', 'endpoint-alpha'] as const) {
      const input = gradientScene(fixture('bows'), preset)
      const configuration = { ...DEFAULTS, endpointColors: true, pointDefaultColor: [0.25, 0.6, 0.8, 0] as [number, number, number, number] }
      const a = await webgl.render(input, configuration, 'front', false)
      const b = await webgpu.render(input, configuration, 'front', false)
      const result = await compare(a, b, reference(input, configuration))
      expect(result.colors.budgetFailures, JSON.stringify(result)).toBe(0)
      expect(result.cpuColors.webgl.budgetFailures, JSON.stringify(result)).toBe(0)
      expect(result.cpuColors.webgpu.budgetFailures, JSON.stringify(result)).toBe(0)
    }
    const scene = gradientScene(fixture('bows'), 'endpoints'); const settings = { ...DEFAULTS, endpointColors: true }
    const a = await webgl.render(scene, settings, 'front', false); const b = await webgpu.render(scene, settings, 'front', false)
    const result = await compare(a, b, reference(scene, settings))
    // The known bow boundary remains subject to the full acceptance report below.
    expect(result.colors.budgetFailures, JSON.stringify(result)).toBe(0)
    expect(result.cpuColors.webgl.budgetFailures, JSON.stringify(result)).toBe(0)
    expect(result.cpuColors.webgpu.budgetFailures, JSON.stringify(result)).toBe(0)
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 120000)

it('records the curved endpoint-gradient matrix with unchanged full-frame gates', async () => {
  const webgl = await createCurvesWebGL(document.createElement('canvas'))
  let webgpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    webgpu = await createCurvesWebGPU(document.createElement('canvas'))
    const solidRows = await runSweep({ webgl, webgpu }, () => {}, () => false)
    const rows = await runSweep({ webgl, webgpu }, () => {}, () => false, 'endpoints')
    await writeArtifact('curved-link-endpoint-gradients', {
      browser: navigator.userAgent, devices: { webgl: webgl.info, webgpu: webgpu.info }, solidRows, rows,
    })
    expect(rows).toHaveLength(64)
    expect(rows.every(r => r.frontPreservation.webgl.changedPixels === 0 && r.frontPreservation.webgpu.changedPixels === 0)).toBe(true)
    expect(rows.map(r => [r.frontPassed, r.front.idDifferences, r.front.masks]))
      .toEqual(solidRows.map(r => [r.frontPassed, r.front.idDifferences, r.front.masks]))
    expect(rows.some(r => !r.frontPassed)).toBe(true)
  } finally { webgpu?.destroy(); webgl.destroy() }
}, 300000)
