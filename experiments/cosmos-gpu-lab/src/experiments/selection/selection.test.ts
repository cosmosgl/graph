import { expect, it } from 'vitest'
import type { Device } from '@luma.gl/core'
import { createDevice } from '../../gpu/luma'
import { describeEnvironment } from '../../gpu/force-preview'
import { writeArtifact } from '../../testing/artifacts'
import { createSelectionWebGL, createSelectionWebGPU } from './backend'
import { pointAt, selectedByReference, type Camera, type Pair, type Point, type Query } from './reference'

const base: Camera = {
  viewport: [256, 128],
  origin: [48, -64],
  translation: [0, 0],
  zoom: 1,
  ratio: 1,
  sizeScale: 1,
  maxSize: 16,
  scaleOnZoom: false,
}
const rect: Query = { rect: [[60, 36], [100, 68]] }
const square: Pair[] = [[60, 36], [100, 36], [100, 68], [60, 68]]
const concave: Pair[] = [[60, 36], [100, 36], [100, 68], [86, 68], [86, 48], [74, 48], [74, 68], [60, 68]]
const edgeWitnesses: [Pair, number, number?][] = [
  [[80, 52], 4], [[80, 52], 4, 1], [[80, 52], 0],
  [[58, 52], 4], [[57.96875, 52], 4], [[102, 52], 4], [[102.03125, 52], 4],
  [[80, 34], 4], [[80, 33.96875], 4], [[80, 70], 4], [[80, 70.03125], 4],
  [[59.5, 52], 0.125], [[59.46875, 52], 0.125], [[52, 52], 40], [[51.96875, 52], 40],
  [[60, 36], 4], [[100, 68], 4], [[100, 52], 4], [[80, 36], 4], [[80, 68], 4], [[60, 52], 4],
  [[90, 58], 4], [[67, 56], 4], [[80, 52], 4, 0.5], [[80, 52], 4, 0.5009765625], [[309, 100], 4],
  [[59.75, 52], 0.125], [[59.71875, 52], 0.125],
]
const edges = edgeWitnesses.map(([position, size, absent]) => pointAt(base, position, size, absent))
const panned: Camera = { ...base, translation: [0.25, -0.5], zoom: 2, ratio: 2 }
const pannedRect: Query = { rect: [[24, 40], [104, 104]] }
const pannedSquare: Query = { polygon: [[24, 40], [104, 40], [104, 104], [24, 104]] }
const highZoom: Camera = { ...base, zoom: 1024, maxSize: 32 }
const zoomTies = [pointAt(highZoom, [50, 52], 4), pointAt(highZoom, [49.96875, 52], 4)]
const irregular: Camera = {
  viewport: [301, 197],
  origin: [-1128.25, 403.5],
  translation: [-0.1875, 0.3125],
  zoom: 0.5,
  ratio: 1.5,
  sizeScale: 1.25,
  maxSize: 14.75,
  scaleOnZoom: true,
}
const seed = 29471
let randomState = seed
function pick (limit: number): number {
  randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0
  return (randomState >>> 9) % limit
}
const seeded = Array.from({ length: 257 }, (_, index) => pointAt(irregular,
  [pick(604) / 2 + 0.125, pick(396) / 2 + 0.125], index % 13 === 0 ? 0 : pick(80) / 8 + 0.125, Number(index % 17 === 0)))
const closedSquare: Pair[] = Array.from({ length: 2045 }, () => square[0]).concat(square.slice(1))
const truncatedSquare: Pair[] = Array.from({ length: 2047 }, () => square[0]).concat(square.slice(1))

type Trial = { name: string; points: Point[]; camera: Camera; query: Query; expected?: number[] }
const squareIds = [0, 2, 19, 20, 21, 22, 23]
const rectIds = [0, 3, 5, 7, 9, 11, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27]
const retinaRectIds = [0, 3, 5, 7, 9, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26]
const truncatedIds = [0, 2, 3, 4, 11, 12, 13, 14, 19, 20, 21, 22, 23, 26, 27]
const seededPolygon: Query = { polygon: [[44, 31], [239, 48], [200, 181], [146, 129], [92, 169]] }
const wholeViewport: Query = { polygon: [[0, 0], [256, 0], [256, 128], [0, 128]] }
const replacement = [edges[1], edges[2], edges[0]]
const trials: Trial[] = [
  { name: 'Inclusive rect and sprite footprint', points: edges, camera: base, query: rect, expected: rectIds },
  { name: 'One-device-pixel minimum at DPR 2', points: edges, camera: { ...base, ratio: 2 }, query: rect, expected: retinaRectIds },
  { name: 'Zero global point scale', points: edges, camera: { ...base, sizeScale: 0 }, query: rect, expected: [] },
  { name: 'Polygon center and half-open edges', points: edges, camera: base, query: { polygon: square }, expected: squareIds },
  { name: 'Concave notch and repeated closure', points: edges, camera: base, query: { polygon: [...concave, concave[0]] }, expected: [20, 21, 22] },
  { name: 'Reversed polygon winding', points: edges, camera: base, query: { polygon: [...square].reverse() }, expected: squareIds },
  { name: 'Short polygon', points: edges, camera: base, query: { polygon: square.slice(0, 2) }, expected: [] },
  { name: 'Three identical vertices', points: edges, camera: base, query: { polygon: [square[0], square[0], square[0]] }, expected: [] },
  { name: 'Empty data after populated requests', points: [], camera: base, query: rect, expected: [] },
  { name: 'Panned DPR 2 view with stable point sizes', points: edges, camera: panned, query: pannedRect },
  { name: 'Panned DPR 2 view with zoom-scaled footprints', points: edges, camera: { ...panned, scaleOnZoom: true }, query: pannedRect },
  { name: 'Panned DPR 2 view with polygon center', points: edges, camera: panned, query: pannedSquare, expected: squareIds },
  { name: 'Large zoom clamps held size growth at five', points: zoomTies, camera: highZoom, query: rect, expected: [0] },
  { name: 'Exactly 2048 polygon edges', points: edges, camera: base, query: { polygon: closedSquare }, expected: squareIds },
  { name: 'Truncation includes vertex 2048', points: edges, camera: base, query: { polygon: truncatedSquare }, expected: truncatedIds },
  { name: '257 points with non-power-of-two viewport and fractional style', points: seeded, camera: irregular, query: { rect: [[44, 30], [222, 154]] } },
  { name: '257 points and oblique polygon edges', points: seeded, camera: irregular, query: seededPolygon },
  { name: 'Replacement leaves only new indices', points: replacement, camera: base, query: rect, expected: [2] },
  { name: 'Replacement polygons ignore texture padding', points: replacement, camera: base, query: wholeViewport, expected: [1, 2] },
]

it('checks the independent selection reference against explicit boundary witnesses', () => {
  for (const { name, points, camera, query, expected } of trials) {
    if (expected) expect(selectedByReference(points, camera, query), name).toEqual(expected)
  }
})

it('matches exact ordered rectangle and polygon IDs against production shaders and the CPU reference', async () => {
  const apis = ['webgl', 'webgpu'] as const
  const canvases = apis.map(() => document.createElement('canvas'))
  const devices: Device[] = []
  const errors: string[] = []
  const rows: { name: string; count: number; reference: number[]; webgl?: number[]; webgpu?: number[] }[] = []
  const backends: Array<ReturnType<typeof createSelectionWebGL>> = []
  try {
    for (const [i, api] of apis.entries()) {
      const device = await createDevice(api, canvases[i], false, error => { errors.push(`${api}: ${error.message}`) })
      devices.push(device)
      backends.push(api === 'webgl' ? createSelectionWebGL(device) : await createSelectionWebGPU(device))
    }
    for (const { name, points, camera, query } of trials) {
      const row: typeof rows[number] = { name, count: points.length, reference: selectedByReference(points, camera, query) }
      rows.push(row)
      for (const [i, api] of apis.entries()) {
        try { row[api] = await backends[i].select(points, camera, query) } catch (error) { errors.push(`${name} ${api}: ${String(error)}`) }
      }
    }
  } finally {
    try {
      await writeArtifact('selection-parity', {
        revision: import.meta.env.LAB_SOURCE_REVISION,
        snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
        seed,
        environments: devices.map((device, i) => describeEnvironment(device, canvases[i])),
        rows,
        errors,
      })
    } finally {
      for (const backend of backends) backend.destroy()
      for (const device of devices) device.destroy()
    }
  }
  expect(errors).toEqual([])
  for (const { name, reference, webgl, webgpu } of rows) {
    expect(webgl, `${name} WebGL`).toEqual(reference)
    expect(webgpu, `${name} WebGPU`).toEqual(reference)
  }
})
