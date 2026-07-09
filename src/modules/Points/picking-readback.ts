/**
 * Asynchronous small-window readback of the picking buffer.
 *
 * `readPixels` into a `PIXEL_PACK_BUFFER` is non-blocking; the result is
 * collected with `getBufferSubData` only after a fence (`fenceSync`) reports
 * that the GPU reached the copy, so hover detection never stalls the pipeline
 * the way a synchronous `readPixels` does. The price is that a result arrives
 * one or more frames after it was requested — imperceptible for hover.
 *
 * luma.gl v9's `Buffer.readAsync` calls `getBufferSubData` immediately (no
 * fence), so this helper drives the raw WebGL2 objects itself, saving and
 * restoring the framebuffer binding the same way luma's own copy helpers do.
 */
export class PickingReadback {
  private gl: WebGL2RenderingContext
  private buffer: WebGLBuffer | null = null
  private sync: WebGLSync | null = null
  private data: Float32Array
  private isInFlight = false

  public constructor (gl: WebGL2RenderingContext, floatsLength: number) {
    this.gl = gl
    this.data = new Float32Array(floatsLength)
  }

  public get inFlight (): boolean {
    return this.isInFlight
  }

  /**
   * Starts an async read of an RGBA32F window from the framebuffer.
   * Returns `false` (and does nothing) while a previous read is still in flight.
   */
  public issue (framebuffer: WebGLFramebuffer, x: number, y: number, width: number, height: number): boolean {
    if (this.isInFlight) return false
    const { gl } = this
    if (width * height * 4 > this.data.length) return false

    this.buffer ||= gl.createBuffer()
    if (!this.buffer) return false

    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.data.byteLength, gl.STREAM_READ)
    gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer)

    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    this.isInFlight = this.sync !== null
    return this.isInFlight
  }

  /**
   * Polls the fence. Returns the window's pixels once the GPU has finished the
   * copy (the `getBufferSubData` is then guaranteed not to stall), or `null`
   * while the read is still pending or nothing is in flight.
   * The returned array is reused by subsequent reads — consume it immediately.
   */
  public poll (): Float32Array | null {
    if (!this.isInFlight || !this.sync || !this.buffer) return null
    const { gl } = this
    const status = gl.clientWaitSync(this.sync, 0, 0)
    if (status === gl.TIMEOUT_EXPIRED) return null

    gl.deleteSync(this.sync)
    this.sync = null
    this.isInFlight = false
    if (status === gl.WAIT_FAILED) return null

    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return this.data
  }

  /** Drops an in-flight read (e.g. when the buffer it targeted was recreated). */
  public cancel (): void {
    if (this.sync) {
      this.gl.deleteSync(this.sync)
      this.sync = null
    }
    this.isInFlight = false
  }

  public destroy (): void {
    this.cancel()
    if (this.buffer) {
      this.gl.deleteBuffer(this.buffer)
      this.buffer = null
    }
  }
}
