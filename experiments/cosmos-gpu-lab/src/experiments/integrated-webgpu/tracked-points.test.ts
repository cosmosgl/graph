import { luma } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { describeEnvironment } from '../../gpu/force-preview'
import { createDevice } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { workload } from './data'
import { createTrackedPoints } from './tracked-points'

it('gathers requested current positions in order without copying the full graph', async () => {
  const scope = resourceScope()
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  scope.own({ destroy: () => canvas.remove() })
  const errors: string[] = []
  const rows: Array<{ label: string; tracked: number; present: number; readBytes: number }> = []
  const report: Record<string, unknown> = { luma: luma.VERSION, rows, errors, pointCount: 257 }
  try {
    const device = scope.own(await createDevice('webgpu', canvas, false, error => {
      errors.push(error.message)
      return true
    }))
    report.environment = describeEnvironment(device, canvas)
    expect(device.info.fallback).toBe(false)
    const fixture = workload('chain', 257)
    const { points } = fixture.input
    points.set([6, 7, 1, 0], 4)
    points.set([8, 9, 0, 1], 8)
    const layout = scope.own(await createCombinedWebGPU(canvas, fixture.graph, fixture.input, 'baseline', {
      context: { device }, repulsionPolicy: 'production',
    }))
    const tracker = scope.own(await createTrackedPoints(device))
    const source = layout.positionSource!
    const read = (ids: readonly number[]): ReturnType<typeof tracker.read> => tracker.read(source(), ids)
    const ids = [256, 2, 1, 0, -1, 1, 257, 1.5, 2 ** 32]
    const check = async (
      label: string, request: ReturnType<typeof read>, reference: Float32Array, indices = ids
    ): Promise<void> => {
      const array: number[] = []
      const map = new Map<number, [number, number]>()
      for (const index of indices) {
        const offset = index * 4
        if (!Number.isInteger(index) || index < 0 || offset >= reference.length || reference[offset + 3] > 0.5) {
          array.push(NaN, NaN)
          continue
        }
        const coordinate: [number, number] = [reference[offset], reference[offset + 1]]
        array.push(...coordinate)
        map.set(index, coordinate)
      }
      const actual = await request
      expect([...actual.array], label).toEqual(array)
      expect([...actual.map], label).toEqual([...map])
      rows.push({ label, tracked: indices.length, present: map.size, readBytes: indices.length * 8 })
    }
    await check('empty request', read([]), points, [])
    await check('initial order, absence, duplicate and pin', read(ids), points)
    layout.stepStage('gravity', 1)
    const moved = (await layout.read()).positions
    expect(moved[0]).not.toEqual(points[0])
    await check('after a GPU position write', read(ids), moved)

    const changingIds = [0, 2, 256]
    const pending = read(changingIds)
    changingIds[0] = 1
    layout.patchPositions!(0, new Float32Array([27, 17, 0, 1, 6, 7, 1, 0, 8, 9, 0, 0]))
    const afterPatch = new Float32Array(moved)
    afterPatch.set([27, 17, 0, 1, 6, 7, 1, 0, 8, 9, 0, 0])
    const patched = read(changingIds)
    await check('overlapping read sees its own point list', patched, afterPatch, changingIds)
    await check('earlier read keeps its input and GPU snapshot', pending, moved, [0, 2, 256])

    const smaller = workload('chain', 32)
    layout.resizeGraph!(smaller.graph, smaller.input, true)
    await check('shrink keeps positions and hides out-of-range IDs', read(ids), afterPatch.slice(0, 32 * 4))
    layout.resizeGraph!(fixture.graph, fixture.input, true)
    const regrown = new Float32Array(points)
    regrown.set(afterPatch.subarray(0, 32 * 4))
    await check('regrow restores ID slots', read(ids), regrown)
    const many = Array.from({ length: 97 }, (_, index) => (index * 17) % 257)
    await check('partial final workgroup', read(many), regrown, many)
    expect(errors).toEqual([])
  } catch (error) {
    report.failure = String(error)
    throw error
  } finally {
    try { scope.destroy() } finally { await writeArtifact('tracked-points', report) }
  }
})
