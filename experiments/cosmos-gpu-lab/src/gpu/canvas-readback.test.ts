import { expect, it } from 'vitest'
import { createDevice } from './luma'
import { pixels, target } from './rgba-readback'

// A successful adapter/offscreen probe does not establish that the browser can
// present a WebGPU canvas. Test both paths before diagnosing shader arithmetic.
for (const canvas of [false, true]) {
  it(`reads an offscreen attachment after submission, canvas=${canvas}`, async () => {
    const device = await createDevice('webgpu', canvas ? document.createElement('canvas') : undefined, false)
    let output: ReturnType<typeof target> | undefined
    try {
      output = target(device, 1, 1)
      if (canvas) {
        const pass = device.beginRenderPass({ clearColor: [0.25, 0.5, 0.75, 1], clearDepth: false })
        pass.end()
      }
      const pass = device.beginRenderPass({ framebuffer: output.framebuffer, clearColor: [0.25, 0.5, 0.75, 1], clearDepth: false })
      pass.end(); device.submit()
      expect(Array.from(await pixels(device, output.texture, output.framebuffer))).toEqual([64, 128, 191, 255])
    } finally { output?.destroy(); device.destroy() }
  })
}
