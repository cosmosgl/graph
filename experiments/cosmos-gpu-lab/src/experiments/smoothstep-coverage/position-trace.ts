import { Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { RenderKernel } from '@luma.gl/graph'
import { bindingLayout, createDevice, upload } from '../../gpu/luma'
import { floatPixels, target } from '../../gpu/rgba-readback'
import { resourceScope } from '../../gpu/resource-scope'
import { capturedQuad, type Vec } from '../straight-links/raster-math'
import { compareLine, type Lane } from './line-study'
import { roundingExample } from './rounding-example'

type Mode = 'smooth' | 'linear' | 'flat'
type ProbeSample = { available: boolean; local: number; pixel: Vec }
type Replay = { source: Lane; backend: Lane; sample: ProbeSample; carrierDifferences: number;
  positionDifferences: number; maxPositionDifference: number; }
type Control = { name: string; backend: Lane; mode: Mode; sample: ProbeSample }
export type PositionTrace = {
  info: Record<Lane, string>;
  native: Record<Lane, { local: number; color: number[]; picked: number | null }>;
  vertices: Record<Lane, { clip: Vec[]; screen: Vec[] }>;
  sameVertices: boolean;
  unclipped: boolean;
  idealInputPosition: number;
  capturedGeometryPosition: Record<Lane, number>;
  replays: Replay[];
  controls: Control[];
  lengthSweep: Array<{ length: number; webgl: ProbeSample; webgpu: ProbeSample; direct: number; sharedReciprocal: number }>;
}

const CORNERS = [0.5, -0.5, 0.5, -0.5]
const PIXEL: Vec = [100.5, 96.5]
const LENGTHS = [64, 80, 96, 112, 120, 128, 144, 160, 176, 180, 192, 200, 208, 224, 240, 256, 320]
const same = (a: Vec[], b: Vec[]): boolean => a.every((v, i) => v[0] === b[i][0] && v[1] === b[i][1])
function exactRectangle (length: number, oppositeDiagonal = false): { clip: Vec[]; values: number[] } {
  const corners: Vec[] = [[40, 93], [40, 97], [40 + length, 93], [40 + length, 97]]
  const order = oppositeDiagonal ? [1, 0, 3, 2] : [0, 1, 2, 3]
  return {
    clip: order.map(i => [Math.fround(2 * corners[i][0] / 512 - 1), Math.fround(1 - 2 * corners[i][1] / 512)]),
    values: order.map(i => CORNERS[i]),
  }
}

// Compute an ideal interpolation of the captured float32 clip vertices in
// double precision. This is explanatory only, not a hardware conformance oracle.
export function interpolatedPosition (quad: Vec[], values: number[], pixel: Vec): number {
  const cross = (a: Vec, b: Vec, p: Vec): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  for (const [i, j, k] of [[0, 1, 2], [2, 1, 3]]) {
    const [a, b, c] = [quad[i], quad[j], quad[k]]; const area = cross(a, b, c)
    if (area === 0) continue
    const weights = [cross(b, c, pixel) / area, cross(c, a, pixel) / area, cross(a, b, pixel) / area]
    if (weights.every(weight => weight >= 0 && weight <= 1)) return weights[0] * values[i] + weights[1] * values[j] + weights[2] * values[k]
  }
  throw new Error('The sample is outside the captured line')
}

function readSample (data: Float32Array, width: number): ProbeSample {
  const i = (96 * width + 100) * 4
  return { available: data[i + 3] > 0, local: data[i], pixel: [data[i + 1], data[i + 2]] }
}

function compareNative (native: Float32Array, replay: Float32Array): Pick<Replay, 'carrierDifferences' | 'positionDifferences' | 'maxPositionDifference'> {
  let carrierDifferences = 0; let positionDifferences = 0; let maxPositionDifference = 0
  for (let i = 0; i < native.length; i += 4) {
    const a = native[i + 3] > 0; const b = replay[i + 3] > 0
    if (a !== b) carrierDifferences++
    if (a && b && native[i] !== replay[i]) {
      positionDifferences++; maxPositionDifference = Math.max(maxPositionDifference, Math.abs(native[i] - replay[i]))
    }
  }
  return { carrierDifferences, positionDifferences, maxPositionDifference }
}

function glVertex (mode: Mode): string {
  const qualifier = mode === 'flat' ? 'flat ' : ''
  return `#version 300 es
in vec2 clipPosition;
in float linePosition;
${qualifier}out float positionInLine;
void main() { gl_Position = vec4(clipPosition, 0.0, 1.0); positionInLine = linePosition; }`
}
function glFragment (mode: Mode, height: number): string {
  const qualifier = mode === 'flat' ? 'flat ' : ''
  return `#version 300 es
precision highp float;
${qualifier}in float positionInLine;
out vec4 color;
void main() { color = vec4(positionInLine, gl_FragCoord.x, ${height.toFixed(1)} - gl_FragCoord.y, 1.0); }`
}
function gpuSource (mode: Mode): string {
  const qualifier = mode === 'flat' ? '@interpolate(flat) ' : mode === 'linear' ? '@interpolate(linear, center) ' : ''
  return `@group(0) @binding(0) var<storage,read> corners: array<vec4f>;
struct Vertex { @builtin(position) position: vec4f, @location(0) ${qualifier}positionInLine: f32 }
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> Vertex {
  var result: Vertex; result.position = vec4f(corners[i].xy, 0, 1); result.positionInLine = corners[i].z; return result;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  return vec4f(input.positionInLine, input.position.x, input.position.y, 1);
}`
}

async function createProbe (lane: Lane): Promise<{ run: (clip: Vec[], height: number, values: number[], mode: Mode) => Promise<Float32Array>;
  destroy: () => void; }> {
  const device = await createDevice(lane, document.createElement('canvas'), false)
  return {
    async run (clip, height, values, mode): Promise<Float32Array> {
      if (lane === 'webgl' && mode === 'linear') throw new Error('Linear interpolation is only probed on WebGPU')
      const frame = resourceScope()
      try {
        const output = frame.own(target(device, 512, height, 'rgba32float'))
        const pass = device.beginRenderPass({ framebuffer: output.framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
        try {
          if (lane === 'webgl') {
            const positions = frame.own(device.createBuffer({ data: new Float32Array(clip.flat()) }))
            const locals = frame.own(device.createBuffer({ data: new Float32Array(values) }))
            const model = frame.own(new Model(device, {
              vs: glVertex(mode),
              fs: glFragment(mode, height),
              topology: 'triangle-strip',
              vertexCount: 4,
              bufferLayout: [{ name: 'clipPosition', format: 'float32x2' }, { name: 'linePosition', format: 'float32' }],
              attributes: { clipPosition: positions, linePosition: locals },
              parameters: { blend: false, cullMode: 'none', depthWriteEnabled: false, depthCompare: 'always' },
            }))
            model.draw(pass)
          } else {
            const entries = new Float32Array(clip.flatMap(([x, y], i) => [x, y, values[i], 0]))
            const buffer = frame.own(upload(device, entries, Buffer.STORAGE))
            const shaderLayout = { attributes: [], bindings: bindingLayout([['corners', 'read-only-storage']]) }
            const vertexArray = frame.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
            const code = gpuSource(mode)
            const kernel = frame.own(new RenderKernel(device, {
              vertexSource: code,
              fragmentSource: code,
              vertexEntryPoint: 'vertexMain',
              fragmentEntryPoint: 'fragmentMain',
              topology: 'triangle-strip',
              shaderLayout,
              colorAttachmentFormats: ['rgba32float'],
              parameters: { blend: false, cullMode: 'none' },
            }))
            kernel.draw(pass, { vertexArray, vertexCount: 4, bindings: { corners: buffer } })
          }
        } finally { pass.end() }
        device.submit()
        return await floatPixels(device, output.texture, output.framebuffer)
      } finally { frame.destroy() }
    },
    destroy (): void { device.destroy() },
  }
}

export async function tracePosition (): Promise<PositionTrace> {
  const line = await compareLine(0, false)
  const vertices = {
    webgl: capturedQuad(line.snapshots.webgl.descending.probe?.vertices, 1, 512, 320),
    webgpu: capturedQuad(line.snapshots.webgpu.descending.probe?.vertices, 1, 512, 320),
  }
  const info = line.info
  const replays: Replay[] = []; const controls: Control[] = []
  const lengths: Record<Lane, Record<number, ProbeSample>> = { webgl: {}, webgpu: {} }
  const probes: Partial<Record<Lane, Awaited<ReturnType<typeof createProbe>>>> = {}
  try {
    probes.webgl = await createProbe('webgl'); probes.webgpu = await createProbe('webgpu')
    for (const source of ['webgl', 'webgpu'] as const) {
      for (const backend of ['webgl', 'webgpu'] as const) {
        const output = await probes[backend]!.run(vertices[source].clip, 320, CORNERS, 'smooth')
        const native = line.snapshots[backend].descending.probe!.varying
        replays.push({ source, backend, sample: readSample(output, 512), ...compareNative(native, output) })
      }
    }
    const exact = exactRectangle(180)
    for (const backend of ['webgl', 'webgpu'] as const) {
      const aligned = await probes[backend]!.run(exact.clip, 512, exact.values, 'smooth')
      controls.push({ name: 'Exact clip coordinates, 512-pixel viewport', backend, mode: 'smooth', sample: readSample(aligned, 512) })
      for (const length of LENGTHS) {
        const rectangle = exactRectangle(length)
        const output = await probes[backend]!.run(rectangle.clip, 512, rectangle.values, 'smooth')
        lengths[backend][length] = readSample(output, 512)
      }
      const opposite = exactRectangle(180, true)
      const swapped = await probes[backend]!.run(opposite.clip, 512, opposite.values, 'smooth')
      controls.push({ name: 'Same rectangle, opposite triangle diagonal', backend, mode: 'smooth', sample: readSample(swapped, 512) })
      for (const mode of ['smooth', 'flat'] as const) {
        const constant = await probes[backend]!.run(vertices.webgl.clip, 320, [-0.375, -0.375, -0.375, -0.375], mode)
        controls.push({ name: 'Same value at all corners', backend, mode, sample: readSample(constant, 512) })
      }
    }
    const linear = await probes.webgpu.run(vertices.webgl.clip, 320, CORNERS, 'linear')
    controls.push({ name: 'Explicit linear interpolation', backend: 'webgpu', mode: 'linear', sample: readSample(linear, 512) })
    return {
      info,
      native: {
        webgl: { local: line.samples.webgl.descending.position, color: line.samples.webgl.descending.color, picked: line.samples.webgl.descending.picked },
        webgpu: { local: line.samples.webgpu.descending.position, color: line.samples.webgpu.descending.color, picked: line.samples.webgpu.descending.picked },
      },
      vertices,
      sameVertices: same(vertices.webgl.clip, vertices.webgpu.clip),
      unclipped: Object.values(vertices).every(quad => quad.clip.every(([x, y]) => Math.abs(x) < 1 && Math.abs(y) < 1)),
      idealInputPosition: -0.375,
      capturedGeometryPosition: {
        webgl: interpolatedPosition(vertices.webgl.screen, CORNERS, PIXEL),
        webgpu: interpolatedPosition(vertices.webgpu.screen, CORNERS, PIXEL),
      },
      replays,
      controls,
      lengthSweep: LENGTHS.map(length => ({ length, webgl: lengths.webgl[length], webgpu: lengths.webgpu[length], ...roundingExample(length) })),
    }
  } finally { probes.webgpu?.destroy(); probes.webgl?.destroy() }
}
