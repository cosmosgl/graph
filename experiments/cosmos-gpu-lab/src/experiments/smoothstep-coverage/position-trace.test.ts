import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { interpolatedPosition, tracePosition } from './position-trace'
import { roundingExample } from './rounding-example'

it('calculates the ideal position inside a simple rectangle', () => {
  const corners: [number, number][] = [[40, 93], [40, 97], [220, 93], [220, 97]]
  const position = interpolatedPosition(corners, [0.5, -0.5, 0.5, -0.5], [100.5, 96.5])
  expect(position).toBeCloseTo(-0.375, 12)
})

it('shows how two equivalent float32 calculations can land on different sides of the same edge', () => {
  const example = roundingExample()
  expect(example.direct).toBe(-0.375)
  expect(example.sharedReciprocal).toBe(-0.3750000298023224)
})

it('traces captured vertices and the same screen pixel through both renderers', async () => {
  const trace = await tracePosition()
  expect(trace.replays).toHaveLength(4)
  for (const row of trace.replays) {
    expect(row.sample.available).toBe(true)
    expect(row.sample.pixel).toEqual([100.5, 96.5])
    expect(Number.isFinite(row.sample.local)).toBe(true)
  }
  for (const row of trace.controls) {
    expect(row.sample.available).toBe(true)
    expect(row.sample.pixel).toEqual([100.5, 96.5])
    if (row.name === 'Same value at all corners' && row.mode === 'flat') expect(row.sample.local).toBe(-0.375)
  }
  expect(trace.lengthSweep).toHaveLength(17)
  for (const row of trace.lengthSweep) {
    expect(row.webgl.available).toBe(true); expect(row.webgpu.available).toBe(true)
    expect(row.webgl.pixel).toEqual([100.5, 96.5]); expect(row.webgpu.pixel).toEqual([100.5, 96.5])
  }
  expect(trace.vertices.webgl.clip).toHaveLength(4); expect(trace.vertices.webgpu.clip).toHaveLength(4)
  await writeArtifact('smoothstep-position-trace', { browser: navigator.userAgent, trace })
}, 180000)
