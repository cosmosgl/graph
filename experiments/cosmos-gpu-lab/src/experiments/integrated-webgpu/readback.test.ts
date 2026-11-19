import { luma } from '@luma.gl/core'
import { expect, it, vi } from 'vitest'
import { describeEnvironment } from '../../gpu/force-preview'
import { writeArtifact } from '../../testing/artifacts'
import { selectedByReference, type Camera, type Pair, type Point, type Query } from '../selection/reference'
import type { AreaSnapshot, TrackedSnapshot } from './readback'
import { createIntegrated, nextFrame, type Integrated } from './runtime'

const rectangle = (): Query => ({ rect: [[90, 64], [170, 126]] })
const polygon = (): Query => ({ polygon: [[54, 30], [206, 38], [182, 133], [128, 90], [64, 140]] })

function selected (runtime: Integrated, positions: Float32Array, query: Query): number[] {
  // The 384 × 240 logical viewport displays at 256 × 160 CSS pixels in this test.
  const scale = ([x, y]: Pair): Pair => [x * 1.5, y * 1.5]
  const logical: Query = 'rect' in query
    ? { rect: [scale(query.rect[0]), scale(query.rect[1])] }
    : { polygon: query.polygon.map(scale) }
  const { x, y, zoom } = runtime.renderer.camera
  const camera: Camera = {
    origin: [x, y],
    viewport: [384, 240],
    translation: [0, 0],
    zoom,
    ratio: 2,
    sizeScale: 1,
    maxSize: 64,
    scaleOnZoom: false,
  }
  const points = Array.from({ length: positions.length / 4 }, (_, i): Point => ({
    world: [positions[i * 4], positions[i * 4 + 1]], absent: positions[i * 4 + 3], size: runtime.renderer.styles[i * 8 + 4],
  }))
  return selectedByReference(points, camera, logical)
}

function tracked (snapshot: TrackedSnapshot, positions: Float32Array, indices: readonly number[]): void {
  const expected: number[] = []; const map = new Map<number, Pair>()
  for (const id of indices) {
    const offset = id * 4
    if (!Number.isInteger(id) || id < 0 || offset >= positions.length || positions[offset + 3] > 0.5) expected.push(NaN, NaN)
    else {
      const point: Pair = [positions[offset], positions[offset + 1]]
      expected.push(...point); map.set(id, point)
    }
  }
  expect(snapshot.indices).toEqual(indices)
  expect([...snapshot.array]).toEqual(expected)
  expect([...snapshot.map]).toEqual([...map])
}

const metadata = {
  revision: import.meta.env.LAB_SOURCE_REVISION,
  sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
  luma: luma.VERSION,
}

it('selects exact current CSS regions and gathers moving labels from the same GPU graph', async () => {
  const canvas = document.createElement('canvas')
  canvas.style.width = '256px'; canvas.style.height = '160px'; document.body.append(canvas)
  const errors: string[] = []
  const areas: Array<{ label: string; ids: AreaSnapshot | null; expected: number[]; wallMs: number; maskBytes: number }> = []
  const labels: Array<{ frame: number; sample: number | null; revision: number | null; count: number; readBytes: number }> = []
  const report: Record<string, unknown> = { ...metadata, areas, labels, errors, fixture: 'chain', pointCount: 8192, cssViewport: [256, 160], dpr: 2 }
  const ids = [8191, 2, 1, 0, 1, -1, ...Array.from({ length: 91 }, (_, i) => i * 43)]
  const positionsByTick = new Map<number, Float32Array>()
  let failure: unknown; let runtime: Integrated | undefined
  const request = (label: string, query: Query, points: Float32Array): Promise<AreaSnapshot> => {
    const active = runtime!; const expected = selected(active, points, query); const tick = active.tick
    const before = performance.now()
    return active.readback!.selectArea(query).then(snapshot => {
      areas.push({ label, ids: snapshot, expected, wallMs: performance.now() - before, maskBytes: points.length })
      expect(snapshot?.tick, label).toBe(tick); expect(snapshot?.ids, label).toEqual(expected)
      return snapshot!
    })
  }
  try {
    runtime = await createIntegrated(canvas, 'chain', 8192, {
      readback: true,
      onDeviceError: error => { errors.push(error.message); return true },
      async onForceStep () {
        const active = runtime!
        try {
          const positions = (await active.backend.read()).positions
          positionsByTick.set(active.tick, positions)
          const latest = active.readback!.latestTrackedPositions()
          labels.push({
            frame: active.tick,
            sample: latest?.tick ?? null,
            revision: latest?.revision ?? null,
            count: latest?.map.size ?? 0,
            readBytes: latest ? latest.array.byteLength : 0,
          })
          if (latest) {
            const previous = labels.at(-2)?.revision
            expect(latest.tick).toBeLessThanOrEqual(active.tick)
            if (previous !== undefined && previous !== null) expect(latest.revision).toBeGreaterThanOrEqual(previous)
            expect(positionsByTick.has(latest.tick)).toBe(true)
            tracked(latest, positionsByTick.get(latest.tick)!, ids)
          }
          await request(`moving tick ${active.tick}`, active.tick % 2 ? rectangle() : polygon(), positions)
        } catch (cause) { failure = cause; active.pause(); return }
        if (active.tick >= 8) active.pause()
      },
    })
    const readback = runtime.readback!
    const device = runtime.backend.positionSource!().device
    runtime.resize(384, 240, 2)
    report.environment = describeEnvironment(device, canvas)
    expect(device.info.fallback).toBe(false)
    expect([canvas.width, canvas.height]).toEqual([768, 480])
    expect(canvas.getBoundingClientRect().width).toBe(256)
    expect(canvas.getBoundingClientRect().height).toBe(160)
    const [edgeX, edgeY] = runtime.world(84.5 * 3, 100 * 3)
    const [insideX, insideY] = runtime.world(110 * 3, 92 * 3)
    runtime.patchPositions(0, new Float32Array([edgeX, edgeY, 0, 0, edgeX, edgeY, 1, 0, insideX, insideY, 0, 1]))
    runtime.renderer.setStyle(0, [1, 1, 1, 1], 18)
    runtime.renderer.setStyle(1, [1, 1, 1, 1], 2)
    const initial = (await runtime.backend.read()).positions
    positionsByTick.set(0, initial)
    const query = rectangle()
    const old = request('paused rectangle before camera and style writes', query, initial)
    if ('rect' in query) query.rect[0][0] = 200
    runtime.pan(78, 30); runtime.zoom(1.375, 384, 240)
    runtime.renderer.setStyle(0, [1, 1, 1, 1], 0)
    const next = request('paused polygon after pan and fractional zoom', polygon(), initial)
    const [first, second] = await Promise.all([old, next])
    expect(first.ids).toContain(0); expect(first.ids).not.toContain(1); expect(first.ids).not.toContain(2)
    expect(first.ids.length).toBeGreaterThan(0); expect(second.ids.length).toBeGreaterThan(0)
    expect(second.ids).not.toEqual(first.ids)
    readback.setTrackedIndices(ids)
    expect(readback.latestTrackedPositions()).toBeNull()
    await vi.waitFor(() => expect(readback.latestTrackedPositions()).not.toBeNull())
    tracked(readback.latestTrackedPositions()!, initial, ids)
    runtime.resume()
    for (let frame = 0; runtime.running && frame < 120; frame++) await nextFrame()
    runtime.pause(); await runtime.settle()
    if (failure) throw failure
    expect(runtime.tick).toBe(8)
    expect(positionsByTick.get(8)).not.toEqual(initial)
    expect(labels.some(row => row.sample !== null && row.sample > 0)).toBe(true)
    const final = await readback.readTrackedPositions()
    expect(final?.tick).toBe(8); tracked(final!, positionsByTick.get(8)!, ids)
    expect(areas).toHaveLength(10)
    expect(runtime.error || readback.error).toBe('')
    expect(errors).toEqual([])
  } catch (cause) { report.failure = String(cause); throw cause } finally {
    runtime?.destroy(); canvas.remove(); await writeArtifact('moving-area-and-labels', report)
  }
}, 60000)

it('keeps label order and liveness across overlapping reads, replacement and teardown', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128
  document.body.append(canvas)
  const errors: string[] = []; const checks: string[] = []
  const report: Record<string, unknown> = { ...metadata, checks, errors, fixture: 'chain', pointCounts: [257, 32, 257] }
  let runtime: Integrated | undefined
  try {
    const active = await createIntegrated(canvas, 'chain', 257, {
      readback: true, onDeviceError: error => { errors.push(error.message); return true },
    })
    runtime = active
    report.environment = describeEnvironment(active.backend.positionSource!().device, canvas)
    const readback = active.readback!
    const indices = [256, 2, 1, 0, -1, 1, 257, 1.5, 2 ** 32]
    active.patchPositions(1, new Float32Array([6, 7, 1, 0, 8, 9, 0, 1]))
    readback.setTrackedIndices(indices)
    const capture = async (name: string, expected: number[] = indices): Promise<TrackedSnapshot> => {
      const snapshot = await readback.readTrackedPositions()
      expect(snapshot?.tick, name).toBe(active.tick)
      tracked(snapshot!, (await active.backend.read()).positions, expected)
      checks.push(name)
      return snapshot!
    }
    const initial = await capture('ordered initial snapshot with duplicates, invalid IDs, pin and absence')
    await vi.waitFor(() => expect(readback.latestTrackedPositions()?.revision).toBe(initial.revision))
    const old = readback.readTrackedPositions()
    await active.step()
    const moved = await capture('fresh snapshot after a GPU simulation write')
    expect(moved.array).not.toEqual(initial.array)
    expect(await old).toEqual(initial)
    await vi.waitFor(() => expect(readback.latestTrackedPositions()?.revision).toBe(moved.revision))

    active.patchPositions(0, new Float32Array([32, -19, 0, 0]))
    expect(readback.latestTrackedPositions()).toEqual(moved)
    const patched = await capture('coordinate-only write can leave a valid previous snapshot in the cache')
    expect(patched.map.get(0)).toEqual([32, -19])
    await vi.waitFor(() => expect(readback.latestTrackedPositions()?.revision).toBe(patched.revision))

    const pendingTrack = readback.readTrackedPositions(); const pendingArea = readback.selectArea(rectangle())
    active.patchPositions(1, new Float32Array([6, 7, 1, 1]))
    const filtered = readback.latestTrackedPositions()!
    expect(filtered.map.has(1)).toBe(false)
    expect([...filtered.map]).toEqual([...patched.map].filter(([id]) => id !== 1))
    expect([filtered.array[4], filtered.array[5], filtered.array[10], filtered.array[11]]).toEqual([NaN, NaN, NaN, NaN])
    active.patchPositions(1, new Float32Array([28, -17, 1, 0]))
    expect(readback.latestTrackedPositions()?.map.has(1)).toBe(false)
    const revived = await capture('removed ID reappears only after a fresh read')
    expect(revived.map.get(1)).toEqual([28, -17])
    expect(await pendingTrack).toBeNull(); expect(await pendingArea).toBeNull()
    checks.push('removal filters both duplicate slots immediately and invalidates older reads')

    const oldList = readback.readTrackedPositions(); const nextIds = [2, 256, 0, 1, 1]
    readback.setTrackedIndices(nextIds)
    nextIds[0] = 7
    expect(readback.latestTrackedPositions()).toBeNull(); expect(await oldList).toBeNull()
    await capture('ID-list replacement owns its array and hides old entries', [2, 256, 0, 1, 1])
    readback.setTrackedIndices(indices)

    const oldGraph = readback.readTrackedPositions(); const oldGraphArea = readback.selectArea(polygon())
    const shrink = active.replace('chain', 32)
    expect(readback.latestTrackedPositions()).toBeNull()
    expect(await oldGraph).toBeNull(); expect(await oldGraphArea).toBeNull()
    await shrink
    expect((await capture('shrunk graph retains index slots and hides missing IDs')).map.has(256)).toBe(false)
    await active.replace('chain', 257)
    expect((await capture('regrown graph restores tracked ID 256 from new geometry')).map.has(256)).toBe(true)
    const endingTrack = readback.readTrackedPositions(); const endingArea = readback.selectArea(rectangle())
    active.destroy()
    expect(readback.latestTrackedPositions()).toBeNull()
    expect(await endingTrack).toBeNull(); expect(await endingArea).toBeNull()
    checks.push('destroy discards both in-flight requests')
    expect(readback.error).toBe(''); expect(errors).toEqual([])
  } catch (cause) { report.failure = String(cause); throw cause } finally {
    runtime?.destroy(); canvas.remove(); await writeArtifact('viewer-readback-lifecycle', report)
  }
}, 60000)
