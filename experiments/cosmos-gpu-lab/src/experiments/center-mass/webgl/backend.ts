import { luma } from '@luma.gl/core'
import { webgl2Adapter, type WebGLDevice } from '@luma.gl/webgl'
import type { BackendResult, CenterMassBackend } from '../backend'
import centerFragment from './shaders/center.frag.glsl?raw'
import centerVertex from './shaders/center.vert.glsl?raw'
import drawFragment from './shaders/draw.frag.glsl?raw'
import drawVertex from './shaders/draw.vert.glsl?raw'

function createShader (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL could not create a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL could not create a program')
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown program link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export async function createWebGLCenterMass (
  canvas: HTMLCanvasElement,
  pointCount: number
): Promise<CenterMassBackend> {
  const device = await luma.createDevice({
    id: 'center-mass-webgl',
    type: 'webgl',
    adapters: [webgl2Adapter],
    waitForPageLoad: false,
    createCanvasContext: {
      canvas,
      autoResize: false,
      useDevicePixels: false,
    },
    webgl: {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
    },
  }) as WebGLDevice

  const gl = device.handle
  if (!gl.getExtension('EXT_color_buffer_float')) {
    device.destroy()
    throw new Error('EXT_color_buffer_float is required')
  }
  if (!gl.getExtension('EXT_float_blend')) {
    device.destroy()
    throw new Error('EXT_float_blend is required for RGBA32F additive blending')
  }

  const centerProgram = createProgram(gl, centerVertex, centerFragment)
  const drawProgram = createProgram(gl, drawVertex, drawFragment)
  const positionBuffer = gl.createBuffer()
  const centerBuffer = gl.createBuffer()
  const centerTexture = gl.createTexture()
  const centerFramebuffer = gl.createFramebuffer()
  const vertexArray = gl.createVertexArray()

  if (!positionBuffer || !centerBuffer || !centerTexture || !centerFramebuffer || !vertexArray) {
    device.destroy()
    throw new Error('WebGL resource allocation failed')
  }

  gl.bindVertexArray(vertexArray)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, pointCount * 2 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  gl.bindTexture(gl.TEXTURE_2D, centerTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1)

  gl.bindFramebuffer(gl.FRAMEBUFFER, centerFramebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    centerTexture,
    0
  )
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    device.destroy()
    throw new Error('RGBA32F center-mass framebuffer is incomplete')
  }

  const drawColorLocation = gl.getUniformLocation(drawProgram, 'color')
  const drawPointSizeLocation = gl.getUniformLocation(drawProgram, 'pointSize')
  const readback = new Float32Array(4)
  const centerPosition = new Float32Array(2)

  const draw = (centerX: number, centerY: number): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.disable(gl.BLEND)
    gl.clearColor(0.09, 0.1, 0.12, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(drawProgram)
    gl.uniform4f(drawColorLocation, 0.76, 0.82, 0.91, 0.88)
    gl.uniform1f(drawPointSizeLocation, 1)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.POINTS, 0, pointCount)

    centerPosition[0] = centerX
    centerPosition[1] = centerY
    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, centerPosition, gl.DYNAMIC_DRAW)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.uniform4f(drawColorLocation, 1, 0.32, 0.24, 1)
    gl.uniform1f(drawPointSizeLocation, 9)
    gl.drawArrays(gl.POINTS, 0, 1)
  }

  return {
    label: 'WebGL2 · additive RGBA32F blend',
    async run (positions: Float32Array): Promise<BackendResult> {
      const started = performance.now()
      gl.bindVertexArray(vertexArray)
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

      gl.bindFramebuffer(gl.FRAMEBUFFER, centerFramebuffer)
      gl.viewport(0, 0, 1, 1)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(centerProgram)
      gl.drawArrays(gl.POINTS, 0, pointCount)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, readback)

      const count = readback[2]
      const center = {
        x: readback[0] / count,
        y: readback[1] / count,
        count,
      }
      draw(center.x, center.y)

      return {
        center,
        elapsedMilliseconds: performance.now() - started,
      }
    },
    destroy (): void {
      gl.deleteVertexArray(vertexArray)
      gl.deleteFramebuffer(centerFramebuffer)
      gl.deleteTexture(centerTexture)
      gl.deleteBuffer(centerBuffer)
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(drawProgram)
      gl.deleteProgram(centerProgram)
      device.destroy()
    },
  }
}
