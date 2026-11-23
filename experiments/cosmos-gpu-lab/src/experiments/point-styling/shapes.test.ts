import { afterAll, beforeAll, expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { runShapeTrial, shapeGroups } from './shapes-suite'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

let gl: Awaited<ReturnType<typeof createStylingWebGL>>
let gpu: Awaited<ReturnType<typeof createStylingWebGPU>>
beforeAll(async () => {
  gl = await createStylingWebGL(document.createElement('canvas'))
  gpu = await createStylingWebGPU(document.createElement('canvas'))
})
afterAll(() => { try { gl?.destroy() } finally { gpu?.destroy() } })

for (const group of shapeGroups) {
  for (const trial of group.items) {
    it(`${group.heading} ${trial.title}`, async () => {
      const result = await runShapeTrial(trial.id, gl, gpu)
      await writeArtifact(`point-shapes-${trial.id}`, {
        revision: import.meta.env.LAB_SOURCE_REVISION,
        snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
        browser: navigator.userAgent,
        webgl: gl.info,
        webgpu: gpu.adapter,
        trial: trial.id,
        ...result,
      })
      expect(result.status, result.detail).toBe('passed')
    })
  }
}
