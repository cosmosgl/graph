import { luma } from '@luma.gl/core'
import { webgl2Adapter, type WebGLDevice } from '@luma.gl/webgl'
import centerFragment from '../center-mass/webgl/shaders/center.frag.glsl?raw'
import centerVertex from '../center-mass/webgl/shaders/center.vert.glsl?raw'
import type { ReductionBenchmark, ReductionCenter } from '../scalable-reduction/backend'
import { createInitialPositions } from '../scalable-reduction/reference'
import type { SimulationBenchmarkBackend } from './backend'

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
  const vertex = createShader(gl, gl.VERTEX_SHADER, centerVertex)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, centerFragment)
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

export async function createWebGLSimulationBenchmark (
  canvas: HTMLCanvasElement,
  pointCount: number
): Promise<SimulationBenchmarkBackend> {
  const lumaDevice = await luma.createDevice({
    id: `performance-simulation-webgl-${pointCount}`,
    type: 'webgl',
    adapters: [webgl2Adapter],
    waitForPageLoad: false,
    createCanvasContext: { canvas, autoResize: false, useDevicePixels: false },
    webgl: { antialias: false, alpha: false, depth: false, stencil: false },
  }) as WebGLDevice
  const gl = lumaDevice.handle
  if (!gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('EXT_float_blend')) {
    lumaDevice.destroy()
    throw new Error('WebGL float render targets and float blending are required')
  }

  const program = createProgram(gl)
  const vertexArray = gl.createVertexArray()
  const positionBuffer = gl.createBuffer()
  const resultTexture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  if (!vertexArray || !positionBuffer || !resultTexture || !framebuffer) {
    lumaDevice.destroy()
    throw new Error('WebGL benchmark resource allocation failed')
  }

  gl.bindVertexArray(vertexArray)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, createInitialPositions(pointCount), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  gl.bindTexture(gl.TEXTURE_2D, resultTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    resultTexture,
    0
  )
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    lumaDevice.destroy()
    throw new Error('WebGL benchmark framebuffer is incomplete')
  }

  const prepareReduction = (): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.viewport(0, 0, 1, 1)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(program)
    gl.bindVertexArray(vertexArray)
  }

  const drawContribution = (): void => {
    gl.drawArrays(gl.POINTS, 0, pointCount)
  }

  const encodeIteration = (): void => {
    prepareReduction()
    drawContribution()
  }

  const readback = new Float32Array(4)
  return {
    async benchmark (iterations: number): Promise<ReductionBenchmark> {
      const started = performance.now()
      prepareReduction()
      for (let iteration = 0; iteration < iterations; iteration += 1) drawContribution()
      const submitted = performance.now()
      gl.finish()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, readback)
      const totalMilliseconds = performance.now() - started
      return {
        iterations,
        submitMilliseconds: submitted - started,
        totalMilliseconds,
        averageMilliseconds: totalMilliseconds / iterations,
      }
    },
    async readCenter (): Promise<ReductionCenter> {
      encodeIteration()
      gl.finish()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, readback)
      return {
        x: readback[0] / readback[2],
        y: readback[1] / readback[2],
        count: readback[2],
      }
    },
    destroy (): void {
      gl.deleteFramebuffer(framebuffer)
      gl.deleteTexture(resultTexture)
      gl.deleteBuffer(positionBuffer)
      gl.deleteVertexArray(vertexArray)
      gl.deleteProgram(program)
      lumaDevice.destroy()
    },
  }
}
