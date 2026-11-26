import type { DeviceInfo } from '@luma.gl/core'
import type { Engine } from '../production-graph-api/frame'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { defaultDiameter, loadPoints, pointFill, pointsConfig, pointsViewport, type PointPlacement } from './fixture'

export type PointsSession = {
  deviceInfo: DeviceInfo;
  snapshot(): Promise<ImageData>;
  destroy(): void;
}

export async function mountPoints (
  host: HTMLDivElement, engine: Engine, ratio: 1 | 2, diameter: number = defaultDiameter, placement: PointPlacement = 'standard'
): Promise<PointsSession> {
  const doc = host.ownerDocument
  const GRAPH = await loadGraphPackage(engine, doc)
  const graph = new GRAPH(host, { ...pointsConfig, pixelRatio: ratio })
  let closed = false
  const destroy = (): void => {
    if (closed) return
    closed = true
    doc.defaultView?.removeEventListener('pagehide', destroy)
    graph.destroy()
  }
  doc.defaultView?.addEventListener('pagehide', destroy, { once: true })
  try {
    await graph.ready
    if (closed) throw new Error('Graph frame closed during initialization')
    const deviceInfo = graph.simulation.device?.info
    if (deviceInfo?.type !== engine) throw new Error(`Requested ${engine}, but the Graph created a ${deviceInfo?.type} device`)
    const samples = loadPoints(graph, diameter, placement, ratio)
    const canvas = host.querySelector('canvas')
    const capture = doc.createElement('canvas')
    capture.width = pointsViewport.width * ratio
    capture.height = pointsViewport.height * ratio
    const context = capture.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context) throw new Error('Could not read the graph canvas')

    return {
      deviceInfo,
      async snapshot (): Promise<ImageData> {
        if (closed) throw new Error('Graph frame closed')
        // Copy at native resolution in the drawing task, before the browser presents the frame.
        graph.renderOneFrame()
        if (canvas.width !== capture.width || canvas.height !== capture.height) {
          throw new Error(`Expected a ${capture.width} × ${capture.height} canvas, got ${canvas.width} × ${canvas.height}`)
        }
        context.globalCompositeOperation = 'copy'
        context.drawImage(canvas, 0, 0)
        const pixels = context.getImageData(0, 0, capture.width, capture.height)
        for (const { x, y, row, shape } of samples) {
          const offset = (Math.floor(y * ratio) * capture.width + Math.floor(x * ratio)) * 4
          if (pixels.data[offset + 3] !== 255 || pointFill.some((channel, i) => pixels.data[offset + i] !== channel)) {
            throw new Error(`${shape} has no opaque fill at its center in row ${row + 1} of the ${placement} placement`)
          }
        }
        return pixels
      },
      destroy,
    }
  } catch (error) { destroy(); throw error }
}
