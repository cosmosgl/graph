import { luma } from '@luma.gl/core'
import { webgl2Adapter, type WebGLDevice } from '@luma.gl/webgl'
import type { PointRenderBackend, PointRenderData, PointRenderMeasurement } from '../backend'
import fragmentShader from './shaders/circle.frag.glsl?raw'
import vertexShader from './shaders/circle.vert.glsl?raw'

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

function createProgram (gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL could not create a program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown program link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export async function createWebGLPointRenderer (
  canvas: HTMLCanvasElement
): Promise<PointRenderBackend> {
  const lumaDevice = await luma.createDevice({
    id: 'point-rendering-webgl',
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

  const gl = lumaDevice.handle
  const program = createProgram(gl)
  const vertexArray = gl.createVertexArray()
  const positionBuffer = gl.createBuffer()
  const colorBuffer = gl.createBuffer()
  if (!vertexArray || !positionBuffer || !colorBuffer) {
    lumaDevice.destroy()
    throw new Error('WebGL resource allocation failed')
  }

  gl.bindVertexArray(vertexArray)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0)

  const diameterLocation = gl.getUniformLocation(program, 'pointDiameter')
  const completionPixel = new Uint8Array(4)
  let count = 0

  const draw = (diameter: number, clear = true): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (clear) {
      gl.clearColor(0.075, 0.087, 0.105, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(program)
    gl.uniform1f(diameterLocation, diameter)
    gl.bindVertexArray(vertexArray)
    gl.drawArrays(gl.POINTS, 0, count)
  }

  return {
    setData (data: PointRenderData): void {
      count = data.count
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.DYNAMIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.DYNAMIC_DRAW)
    },
    render (diameter: number): void {
      draw(diameter)
    },
    async measure (diameter: number, iterations = 1): Promise<PointRenderMeasurement> {
      const started = performance.now()
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        draw(diameter, iteration === 0)
      }
      const submitted = performance.now()
      gl.finish()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, completionPixel)
      return {
        submitMilliseconds: submitted - started,
        completionMilliseconds: performance.now() - started,
      }
    },
    destroy (): void {
      gl.deleteBuffer(colorBuffer)
      gl.deleteBuffer(positionBuffer)
      gl.deleteVertexArray(vertexArray)
      gl.deleteProgram(program)
      lumaDevice.destroy()
    },
  }
}
