import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { matchesTrackerSnapshot, runHeadlessTrackers } from './headless-trackers'

it('follows independent point groups before data, through edits and after one tracker is destroyed', async () => {
  const gl = await runHeadlessTrackers('webgl')
  await writeArtifact('headless-trackers-webgl', gl)
  const gpu = await runHeadlessTrackers('webgpu')
  await writeArtifact('headless-trackers-webgpu', gpu)
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  for (const run of [gl, gpu]) {
    expect(run.samples).toHaveLength(6)
    const [initial, stepped, retargeted, grown, survivor, end] = run.samples
    for (const [i, sample] of run.samples.entries()) {
      expect(sample.first.indices).toEqual(i < 2 ? [3, 1, 0] : [2, 1, 2, 6])
      expect(sample.second.indices).toEqual([1, 4, 5])
      expect(matchesTrackerSnapshot(sample.first, sample.snapshot), `A: ${sample.phase}`).toBe(true)
      expect(matchesTrackerSnapshot(sample.second, sample.snapshot), `B: ${sample.phase}`).toBe(true)
    }
    expect(initial!.snapshot).toEqual([2000, 2048, 2080, 2048, 2048, 2112, 2128, 2048, NaN, NaN, 2048, 2000])
    expect(initial!.second.positions.map(([id]) => id)).toEqual([1, 5])
    expect(stepped!.first.positions[0]).toEqual([3, 2120, 2048])
    expect(stepped!.snapshot[2]).toBe(Math.fround(2076.8))
    expect(retargeted!.first.positions.map(([id]) => id)).toEqual([2, 1])
    expect(retargeted!.second.positions[0]).toEqual([1, 2140, 2048])
    expect(grown!.first.positions.map(([id]) => id)).toEqual([1, 6])
    expect(grown!.second.positions[1]).toEqual([4, 2048, 2080])
    expect(run.retargeted).toEqual({ first: null, second: stepped!.second.positions })
    expect(run.released).toEqual({ first: null, second: grown!.second.positions })
    expect(survivor!.first.positions).toEqual([])
    // Under gravity 1, a fresh alpha-1 tick moves each point a tenth of its
    // distance to (2048, 2048). All three of B's points have to keep moving.
    expect(survivor!.second.positions).toEqual([
      [1, Math.fround(2130.8), 2048], [4, 2048, Math.fround(2076.8)], [5, 2048, Math.fround(2009.12)],
    ])
    expect(end!.snapshot).toEqual([])
    expect(end!.second.positions).toEqual([])
  }
  expect(gpu.samples).toEqual(gl.samples)
})
