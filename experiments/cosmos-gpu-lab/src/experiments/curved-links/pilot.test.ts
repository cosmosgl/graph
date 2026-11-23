import { afterAll, beforeAll, expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import type { Backend } from './backend'
import { curveTrials, runCurveTrial } from './pilot-suite'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'

let gl: Backend
let gpu: Backend
beforeAll(async () => {
  gl = await createCurvesWebGL(document.createElement('canvas'))
  gpu = await createCurvesWebGPU(document.createElement('canvas'))
})
afterAll(() => { try { gl?.destroy() } finally { gpu?.destroy() } })

for (const trial of curveTrials) {
  it(trial.title, async () => {
    const result = await runCurveTrial(trial.id, gl, gpu)
    await writeArtifact(`curved-links-${trial.id}`, { browser: navigator.userAgent, webgl: gl.info, webgpu: gpu.info, ...result })
    expect(result.status, result.detail).toBe('passed')
  })
}
