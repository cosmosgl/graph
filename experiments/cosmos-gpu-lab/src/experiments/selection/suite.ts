import type { CheckResult, LiveCheckItem } from '../../runtime/live-checks'
import type { SelectionBackend } from './backend'
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
export const selectionSeed = 29471
let randomState = selectionSeed
function pick (limit: number): number {
  randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0
  return (randomState >>> 9) % limit
}
const seeded = Array.from({ length: 257 }, (_, index) => pointAt(irregular,
  [pick(604) / 2 + 0.125, pick(396) / 2 + 0.125], index % 13 === 0 ? 0 : pick(80) / 8 + 0.125, Number(index % 17 === 0)))
const closedSquare: Pair[] = Array.from({ length: 2045 }, () => square[0]).concat(square.slice(1))
const truncatedSquare: Pair[] = Array.from({ length: 2047 }, () => square[0]).concat(square.slice(1))

type Trial = LiveCheckItem & { points: Point[]; camera: Camera; query: Query; expected?: number[]; previousPoints?: Point[] }
const squareIds = [0, 2, 19, 20, 21, 22, 23]
const rectIds = [0, 3, 5, 7, 9, 11, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27]
const retinaRectIds = [0, 3, 5, 7, 9, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26]
const truncatedIds = [0, 2, 3, 4, 11, 12, 13, 14, 19, 20, 21, 22, 23, 26, 27]
const seededPolygon: Query = { polygon: [[44, 31], [239, 48], [200, 181], [146, 129], [92, 169]] }
const wholeViewport: Query = { polygon: [[0, 0], [256, 0], [256, 128], [0, 128]] }
const replacement = [edges[1], edges[2], edges[0]]

export const selectionGroups: { heading: string; items: Trial[] }[] = [
  {
    heading: 'Which dots count at the edge?',
    items: [
      {
        id: 'Inclusive rect and sprite footprint',
        title: 'Rectangle edge',
        recorded: 'passed',
        description: 'A dot is selected when its bounding box just touches the rectangle, even if its center is outside.',
        points: edges,
        camera: base,
        query: rect,
        expected: rectIds,
      },
      {
        id: 'One-device-pixel minimum at DPR 2',
        title: 'Tiny dots',
        recorded: 'passed',
        description: 'At two device pixels per CSS pixel, rectangle selection uses a minimum diameter of one device pixel.',
        points: edges,
        camera: { ...base, ratio: 2 },
        query: rect,
        expected: retinaRectIds,
      },
      {
        id: 'Zero global point scale',
        title: 'Zero size',
        recorded: 'passed',
        description: 'Setting the global point size scale to zero makes the rectangle return no IDs.',
        points: edges,
        camera: { ...base, sizeScale: 0 },
        query: rect,
        expected: [],
      },
      {
        id: 'Polygon center and half-open edges',
        title: 'Lasso edge',
        recorded: 'passed',
        description: 'For a square lasso, centers on the left or bottom edge count, while centers on the right or top edge fall outside.',
        points: edges,
        camera: base,
        query: { polygon: square },
        expected: squareIds,
      },
    ],
  },
  {
    heading: 'Does the way you draw the lasso matter?',
    items: [
      {
        id: 'Concave notch and repeated closure',
        title: 'Inward notch',
        recorded: 'passed',
        description: 'A concave lasso excludes dots in the notch even when the path repeats its starting vertex at the end.',
        points: edges,
        camera: base,
        query: { polygon: [...concave, concave[0]] },
        expected: [20, 21, 22],
      },
      {
        id: 'Reversed polygon winding',
        title: 'Drawing direction',
        recorded: 'passed',
        description: 'Tracing the same square in reverse returns the same IDs in the same order.',
        points: edges,
        camera: base,
        query: { polygon: [...square].reverse() },
        expected: squareIds,
      },
      {
        id: 'Short polygon',
        title: 'Two vertices',
        recorded: 'passed',
        description: 'A two-vertex path returns an empty selection before either GPU runs.',
        points: edges,
        camera: base,
        query: { polygon: square.slice(0, 2) },
        expected: [],
      },
      {
        id: 'Three identical vertices',
        title: 'Repeated vertex',
        recorded: 'passed',
        description: 'A path made of three identical vertices encloses no points.',
        points: edges,
        camera: base,
        query: { polygon: [square[0], square[0], square[0]] },
        expected: [],
      },
      {
        id: 'Exactly 2048 polygon edges',
        title: 'Exactly 2,048 edges',
        recorded: 'passed',
        description: 'A square path padded with repeated vertices still selects the expected dots at the v3.6.0 edge limit.',
        points: edges,
        camera: base,
        query: { polygon: closedSquare },
        expected: squareIds,
      },
      {
        id: 'Truncation includes vertex 2048',
        title: 'Beyond 2,048 edges',
        recorded: 'passed',
        description: 'When the closing edge falls past the cutoff, WebGL and WebGPU both select the same 15 points.',
        points: edges,
        camera: base,
        query: { polygon: truncatedSquare },
        expected: truncatedIds,
      },
    ],
  },
  {
    heading: 'What changes when you pan or zoom?',
    items: [
      {
        id: 'Panned DPR 2 view with stable point sizes',
        title: 'Fixed dot sizes',
        recorded: 'passed',
        description: 'After panning and zooming, the rectangle selects 10 dots when their sizes stay fixed on screen.',
        points: edges,
        camera: panned,
        query: pannedRect,
        expected: [0, 15, 16, 17, 18, 19, 20, 21, 22, 23],
      },
      {
        id: 'Panned DPR 2 view with zoom-scaled footprints',
        title: 'Sizes that grow with zoom',
        recorded: 'passed',
        description: 'The same rectangle selects 14 dots when their diameters scale with zoom.',
        points: edges,
        camera: { ...panned, scaleOnZoom: true },
        query: pannedRect,
        expected: [0, 3, 5, 7, 9, 15, 16, 17, 18, 19, 20, 21, 22, 23],
      },
      {
        id: 'Panned DPR 2 view with polygon center',
        title: 'Lasso after a pan',
        recorded: 'passed',
        description: 'A lasso around the same points after panning and zooming returns the original seven IDs.',
        points: edges,
        camera: panned,
        query: pannedSquare,
        expected: squareIds,
      },
      {
        id: 'Large zoom clamps held size growth at five',
        title: 'Extreme zoom',
        recorded: 'passed',
        description: 'At 1,024× zoom, rectangle selection respects the fivefold cap on dot growth in fixed-size mode.',
        points: zoomTies,
        camera: highZoom,
        query: rect,
        expected: [0],
      },
    ],
  },
  {
    heading: 'Do the IDs still match on a larger scatterplot?',
    items: [
      {
        id: '257 points with non-power-of-two viewport and fractional style',
        title: 'Rectangle',
        recorded: 'passed',
        description: 'On 257 points in a 301 × 197 viewport, fractional dot sizes produce the same ordered IDs as the CPU calculation.',
        points: seeded,
        camera: irregular,
        query: { rect: [[44, 30], [222, 154]] },
      },
      {
        id: '257 points and oblique polygon edges',
        title: 'Slanted lasso',
        recorded: 'passed',
        description: 'On the same scatterplot, a five-vertex lasso with slanted edges selects the IDs predicted by the CPU.',
        points: seeded,
        camera: irregular,
        query: seededPolygon,
      },
    ],
  },
  {
    heading: 'Can an old or unused point ID appear?',
    items: [
      {
        id: 'Empty data after populated requests',
        title: 'Empty dataset',
        recorded: 'passed',
        description: 'A rectangle over an empty dataset returns no IDs after earlier queries selected points.',
        points: [],
        camera: base,
        query: rect,
        expected: [],
        previousPoints: edges,
      },
      {
        id: 'Replacement leaves only new indices',
        title: 'Rectangle after replacement',
        recorded: 'passed',
        description: 'After switching to three points, only the new point at index 2 qualifies.',
        points: replacement,
        camera: base,
        query: rect,
        expected: [2],
        previousPoints: edges,
      },
      {
        id: 'Replacement polygons ignore texture padding',
        title: 'Lasso after replacement',
        recorded: 'passed',
        description: 'A full-view lasso returns IDs 1 and 2 and skips the unused fourth slot in the WebGL texture.',
        points: replacement,
        camera: base,
        query: wholeViewport,
        expected: [1, 2],
        previousPoints: edges,
      },
    ],
  },
]

const trials = new Map(selectionGroups.flatMap(group => group.items.map(trial => [trial.id, trial] as const)))

type TrialResult = CheckResult & { name: string; count: number; reference: number[]; webgl?: number[]; webgpu?: number[] }

function difference (label: string, ids: number[], expected: number[]): string | undefined {
  if (ids.length !== expected.length) return `${label} returned ${ids.length} IDs, expected ${expected.length}.`
  const index = ids.findIndex((id, i) => id !== expected[i])
  if (index >= 0) return `${label} returned ID ${ids[index]} at position ${index + 1}, expected ${expected[index]}.`
  return undefined
}

export async function runSelectionTrial (id: string, gl: SelectionBackend, gpu: SelectionBackend): Promise<TrialResult> {
  const trial = trials.get(id)
  if (!trial) throw new Error(`Unknown selection check: ${id}`)
  const { points, camera, query, expected, previousPoints } = trial
  const reference = selectedByReference(points, camera, query)
  const result: TrialResult = { name: id, count: points.length, reference, status: 'passed' }
  const details = [expected && difference('CPU reference', reference, expected)]
  for (const [api, backend, label] of [['webgl', gl, 'WebGL'], ['webgpu', gpu, 'WebGPU']] as const) {
    try {
      // Prime the previous dataset so replacement checks are independent of suite order.
      if (previousPoints) await backend.select(previousPoints, camera, query)
      const ids = await backend.select(points, camera, query)
      result[api] = ids
      details.push(difference(label, ids, reference))
    } catch (error) {
      details.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const detail = details.filter(Boolean).join(' ')
  if (detail) { result.status = 'failed'; result.detail = detail }
  return result
}
