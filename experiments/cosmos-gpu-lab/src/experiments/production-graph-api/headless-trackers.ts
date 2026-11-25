import type { DeviceInfo } from '@luma.gl/core'
import type { PointTracker } from '../../../../../dist/index.js'
import { loadGraphSimulationPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

type Entry = [id: number, x: number, y: number]
type PositionMap = ReadonlyMap<number, [number, number]>
export type TrackedGroup = { indices: number[]; positions: Entry[]; cached: Entry[]; array: number[]; destroyed: boolean }
export type TrackerSample = { phase: string; snapshot: number[]; first: TrackedGroup; second: TrackedGroup }
type PendingRead = { first: Entry[] | null; second: Entry[] | null }
type TrackerRun = { deviceInfo: DeviceInfo; samples: TrackerSample[]; retargeted: PendingRead; released: PendingRead }

function entries (map: PositionMap): Entry[] {
  return Array.from(map, ([id, [x, y]]) => [id, x, y])
}

function read (tracker: PointTracker): Promise<PositionMap | null> {
  if (!tracker.positionsAsync) throw new Error('This PointTracker has no positionsAsync()')
  return tracker.positionsAsync()
}

async function sampleGroup (tracker: PointTracker, destroyed: boolean): Promise<TrackedGroup> {
  const fresh = await read(tracker)
  if (!fresh) throw new Error('Tracker read was invalidated at a stable checkpoint')
  return {
    indices: [...tracker.indices],
    positions: entries(fresh),
    cached: entries(tracker.positions()),
    array: tracker.positionsArray(),
    destroyed,
  }
}

// The oracle indexes the independent full-position read. A missing point leaves a NaN
// slot in the flat array, and repeated indices appear only once in the map.
export function matchesTrackerSnapshot (group: TrackedGroup, snapshot: number[]): boolean {
  const expected = new Map<number, [number, number]>()
  const array: number[] = []
  if (!group.destroyed) {
    for (const id of group.indices) {
      const x = snapshot[2 * id] ?? NaN
      const y = snapshot[2 * id + 1] ?? NaN
      array.push(x, y)
      if (Number.isFinite(x) && Number.isFinite(y)) expected.set(id, [x, y])
    }
  }
  const ordered = entries(expected)
  const matchesMap = (actual: Entry[]): boolean => actual.length === ordered.length &&
    ordered.every(([id, x, y], i) => actual[i]?.[0] === id && actual[i]?.[1] === x && actual[i]?.[2] === y)
  return matchesMap(group.positions) && matchesMap(group.cached) && group.array.length === array.length &&
    array.every((value, i) => Object.is(value, group.array[i]))
}

async function capturePending (first: PointTracker, second: PointTracker, edit: () => void): Promise<PendingRead> {
  const a = read(first)
  const b = read(second)
  edit()
  const [firstResult, secondResult] = await Promise.all([a, b])
  return { first: firstResult && entries(firstResult), second: secondResult && entries(secondResult) }
}

/** Run the same application on the standalone simulation export, without constructing a Graph or attaching a canvas. */
export async function runHeadlessTrackers (engine: Engine): Promise<TrackerRun> {
  const frame = document.createElement('iframe')
  frame.title = `${engine} headless simulation`
  frame.hidden = true
  document.body.append(frame)
  try {
    const SIMULATION = await loadGraphSimulationPackage(engine, frame.contentDocument!)
    const sim = new SIMULATION({
      rescalePositions: false,
      simulationGravity: 1,
      simulationCenter: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      simulationFriction: 1,
      randomSeed: 17,
    })
    try {
      if (typeof sim.trackPoints !== 'function') throw new Error(`${engine} GraphSimulation has no trackPoints()`)
      const first = sim.trackPoints([3, 1, 0])
      const second = sim.trackPoints([1, 4, 5])
      sim.setPointPositions(Float32Array.of(2000, 2048, 2080, 2048, 2048, 2112, 2128, 2048, NaN, NaN, 2048, 2000), true)
      sim.applyData(1)
      await sim.ready
      const deviceInfo = sim.device?.info
      if (deviceInfo?.type !== engine) throw new Error(`Expected ${engine}, got ${deviceInfo?.type}`)

      const samples: TrackerSample[] = []
      const sample = async (phase: string, firstDestroyed = false, secondDestroyed = false): Promise<void> => {
        const [snapshot, a, b] = await Promise.all([
          sim.getPointPositionsAsync(), sampleGroup(first, firstDestroyed), sampleGroup(second, secondDestroyed),
        ])
        samples.push({ phase, snapshot: Array.from(snapshot), first: a, second: b })
      }
      await sample('Initial groups')
      sim.step()
      await sample('After one gravity step')

      // Change an unshared point before each pair of requests so both start from a new
      // buffer version. B's coordinates still match the preceding checkpoint.
      sim.setPointPosition(0, 2020, 2048)
      const retargeted = await capturePending(first, second, () => {
        first.setIndices([2, 1, 2, 6])
        sim.setPointPosition(1, 2140, 2048)
      })
      await sample('Retarget A and move point 1')

      const grown = Float32Array.from([...samples[2]!.snapshot, 2160, 2048])
      grown.set([NaN, NaN], 2 * 2)
      grown.set([2048, 2080], 2 * 4)
      sim.setPointPositions(grown, true)
      sim.applyData(1)
      await sample('Remove point 2 and grow to seven')

      sim.setPointPosition(0, 2010, 2048)
      const released = await capturePending(first, second, () => {
        first.destroy()
        sim.step()
      })
      await sample('Destroy A and step B', true)
      sim.destroy()
      await sample('Destroy simulation', true, true)
      return { deviceInfo, samples, retargeted, released }
    } finally { sim.destroy() }
  } finally { frame.remove() }
}
