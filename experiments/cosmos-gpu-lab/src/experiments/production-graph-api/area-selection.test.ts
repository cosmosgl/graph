import type { DeviceInfo } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

type Point = [number, number]
const expected = {
  touchRect: [0, 1, 2],
  touchPolygon: [0, 1, 2],
  centerRect: [0, 1],
  centerPolygon: [0, 1],
  diagonal: [0, 1],
  floatVertex: [1],
  squareRect: [0, 1],
  squarePolygon: [0, 1],
  imageRect: [0, 1, 2],
  imagePolygon: [0, 1, 2],
  longPath: [0, 1, 2, 3],
  reversedLongPath: [0, 1, 2, 3],
}

async function replay (engine: Engine, pixelRatio: number): Promise<{ device: DeviceInfo; ids: Record<keyof typeof expected, number[] | null> }> {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:256px;height:256px;border:0;opacity:0;pointer-events:none'
  document.body.append(frame)
  try {
    const doc = frame.contentDocument!
    const host = doc.createElement('div')
    host.style.cssText = 'width:256px;height:256px'
    doc.body.append(host)
    const GRAPH = await loadGraphPackage(engine, doc)
    const graph = new GRAPH(host, {
      pixelRatio,
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
    })
    try {
      await graph.ready
      const device = graph.simulation.device?.info
      if (device?.type !== engine) throw new Error(`Expected ${engine}, got ${device?.type}`)
      graph.setPointPositions(Float32Array.of(2048, 2048, 2064, 2048, 2074, 2048, 2080, 2048, 2044, 2048, NaN, NaN))
      graph.setPointSizes(Float32Array.of(20, 20, 20, 20, 0, 20))
      graph.render(undefined, 0)
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [256, 256])
      graph.renderOneFrame()

      // The right edge contains point 1's center and touches point 2's circle.
      const corners: Point[] = [[112, 112], [144, 112], [144, 144], [112, 144]]
      const rectangle = (): Promise<number[] | null> => graph.findPointsInRectAsync([corners[2]!, corners[0]!])
      const polygon = (): Promise<number[] | null> => graph.findPointsInPolygonAsync(corners)
      const touchRect = await rectangle()
      const touchPolygon = await polygon()
      graph.setConfigPartial({ pointSelectionMode: 'center' })
      const centerRect = await rectangle()
      const centerPolygon = await polygon()
      const diagonal = await graph.findPointsInPolygonAsync([[112, 112], [160, 112], [112, 160]])
      const adjacent = 144 - 2 ** -16
      const floatVertex = await graph.findPointsInPolygonAsync([[adjacent, 120], [144, 128], [adjacent, 136]])

      graph.setConfigPartial({ pointSelectionMode: 'touch' })
      // Shape 1 is an untextured square. An image at that slot restores the circular footprint.
      graph.setPointShapes(Float32Array.of(0, 0, 1, 0, 0, 0))
      graph.render(undefined, 0)
      const squareRect = await rectangle()
      const squarePolygon = await polygon()
      graph.setImageData([new ImageData(1, 1)])
      graph.setPointImageIndices(Float32Array.of(-1, -1, 0, -1, -1, -1))
      graph.render(undefined, 0)
      const imageRect = await rectangle()
      const imagePolygon = await polygon()
      // The last three edges determine containment. The rest of the path has zero-length edges.
      const path: Point[] = Array.from({ length: 32768 }, () => [20, 20])
      path.push([220, 20], [220, 220], [20, 220])
      const longPath = await graph.findPointsInPolygonAsync(path)
      const reversedLongPath = await graph.findPointsInPolygonAsync(path.reverse())
      return {
        device,
        ids: {
          touchRect,
          touchPolygon,
          centerRect,
          centerPolygon,
          diagonal,
          floatVertex,
          squareRect,
          squarePolygon,
          imageRect,
          imagePolygon,
          longPath,
          reversedLongPath,
        },
      }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}

it.each([1, 2])('selects matching default footprints, boundary centers and long lassos through both packages at %i×', async ratio => {
  const webgl = await replay('webgl', ratio)
  const webgpu = await replay('webgpu', ratio)
  await writeArtifact(`package-area-selection-${ratio}x`, { ratio, webgl, webgpu })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(webgl.device.gpuType).not.toBe('cpu')
    expect(webgpu.device.fallback).toBe(false)
  }
  expect(webgl.ids).toEqual(expected)
  expect(webgpu.ids).toEqual(expected)
})
