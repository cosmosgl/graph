import type { Graph } from '../../../../../dist/index.js'
import { positionStats } from './compare'
import type { ScaleFixture } from './scale-fixture'
import { scaleMetrics } from './scale-metrics'

/** Capture coordinates losslessly without constructing a JSON number per coordinate. */
async function encode (xy: Float32Array): Promise<string> {
  const reader = new FileReader()
  const pending = new Promise<string>((resolve, reject) => {
    reader.onload = (): void => resolve(String(reader.result).split(',')[1]!)
    reader.onerror = (): void => reject(reader.error)
  })
  reader.readAsDataURL(new Blob([new Uint8Array(xy.buffer as ArrayBuffer, xy.byteOffset, xy.byteLength)]))
  return await pending
}

type LayoutCheckpoint = {
  step: number; motion: ReturnType<typeof positionStats>; quality: ReturnType<typeof scaleMetrics>; positions: string;
}
export function layoutCheckpoints (
  graph: Graph, fixture: ScaleFixture, read: () => Promise<Float32Array>, activeFrames = false
): (target: number) => Promise<LayoutCheckpoint> {
  let step = 0
  let previous = fixture.positions
  return async (target: number): Promise<LayoutCheckpoint> => {
    if (!Number.isInteger(target) || target < step || target > 100) throw new Error('Invalid layout checkpoint')
    // Keep the work queue bounded across the long cooling interval. A completed
    // fence waits for GPU work without allocating another full XY snapshot.
    while (step < target) {
      const batch = Math.min(4, target - step)
      if (activeFrames) graph.unpause()
      for (let i = 0; i < batch; i++) {
        if (activeFrames) graph.renderOneFrame()
        else graph.step()
      }
      if (activeFrames) graph.pause()
      step += batch
      const fence = graph.simulation.device!.createFence()
      try { await fence.signaled } finally { fence.destroy() }
    }
    // A paused draw while the pointer is held applies an extra repulsion.
    // The active frame above has already drawn the composed layout.
    if (!activeFrames || target === 0) graph.renderOneFrame()
    const xy = await read()
    const motion = positionStats(xy, previous, 1)
    const movedPin = fixture.pinned.find(id => xy[id * 2] !== fixture.positions[id * 2] || xy[id * 2 + 1] !== fixture.positions[id * 2 + 1])
    if (movedPin !== undefined || (step === 0 && motion.different)) throw new Error(`Invalid input or pin at tick ${step}: ${movedPin ?? motion.different}`)
    previous = xy
    // Intermediate million-point checks span all communities and all sizes.
    // The final count includes every pair so settled overlaps can be compared exactly.
    const overlapStride = fixture.metadata.pointCount > 65536 && step < 100 ? 61 : 1
    return { step, motion, quality: scaleMetrics(fixture, xy, overlapStride), positions: await encode(xy) }
  }
}
