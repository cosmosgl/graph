import { afterAll, beforeAll, expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import type { Backend } from './backend'
import { linkGroups, runLinkTrial } from './links-suite'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'

let gl: Backend
let gpu: Backend
beforeAll(async () => {
  gl = await createLinksWebGL(document.createElement('canvas'))
  gpu = await createLinksWebGPU(document.createElement('canvas'))
})
afterAll(() => { try { gl?.destroy() } finally { gpu?.destroy() } })

for (const group of linkGroups) {
  for (const trial of group.items) {
    it(`${group.heading} ${trial.title}`, async () => {
      const result = await runLinkTrial(trial.id, gl, gpu)
      await writeArtifact(`straight-links-${trial.id}`, {
        browser: navigator.userAgent, webgl: gl.info, webgpu: gpu.info, ...result,
      })
      expect(result.status, result.detail).toBe('passed')
    })
  }
}
