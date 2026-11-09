import type { WebGLDevice } from '@luma.gl/webgl'

// luma 10.0.0-alpha.4's readPixelsToArrayWebGL requires a texture attachment and
// rejects the canvas's default framebuffer. Keep this native diagnostic fallback
// isolated; creation, simulation, drawing and texture readback use luma APIs.
export function readCanvasPixels (device: WebGLDevice, width: number, height: number): Uint8Array {
  const gl = device.handle
  const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  const readBuffer = gl.getParameter(gl.READ_BUFFER) as number
  try {
    gl.readBuffer(gl.BACK)
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return pixels
  } finally { gl.readBuffer(readBuffer); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous) }
}
