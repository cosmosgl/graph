import type { Engine } from '../production-graph-api/frame'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { collisionConfig, collisionViewport, loadCollision, type CollisionFixture } from './fixture'

export type CollisionSnapshot = { tick: number; positions: Float32Array; pixels: ImageData }
export type CollisionSession = {
  snapshot(): Promise<CollisionSnapshot>;
  step(): Promise<CollisionSnapshot>;
  destroy(): void;
}

export async function mountCollision (
  host: HTMLDivElement, engine: Engine, fixture: CollisionFixture = 'contacts'
): Promise<CollisionSession> {
  const doc = host.ownerDocument
  const GRAPH = await loadGraphPackage(engine, doc)
  const graph = new GRAPH(host, { ...collisionConfig })
  const capture = doc.createElement('canvas')
  capture.width = collisionViewport.width
  capture.height = collisionViewport.height
  let tick = 0
  let closed = false
  let pending = Promise.resolve()
  const destroy = (): void => {
    if (closed) return
    closed = true
    doc.defaultView?.removeEventListener('pagehide', destroy)
    pending.then(() => graph.destroy())
  }
  doc.defaultView?.addEventListener('pagehide', destroy, { once: true })
  try {
    await graph.ready
    if (closed) throw new Error('Graph frame closed during initialization')
    const actual = graph.simulation.device?.info.type
    if (actual !== engine) throw new Error(`Requested ${engine}, but the Graph created a ${actual} device`)
    loadCollision(graph, fixture)
    const canvas = host.querySelector('canvas')
    const context = capture.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context) throw new Error('Could not read the graph canvas')
    const measure = async (advance: boolean): Promise<CollisionSnapshot> => {
      if (closed) throw new Error('Graph frame closed')
      if (advance) { graph.step(); tick++ }
      const positions = await graph.getPointPositionsAsync()
      // Copy in the same task as the paused draw. The browser can discard the
      // onscreen drawing buffer once it has presented the frame.
      graph.renderOneFrame()
      if (canvas.width !== capture.width || canvas.height !== capture.height) {
        throw new Error(`Expected a ${capture.width} × ${capture.height} canvas, got ${canvas.width} × ${canvas.height}`)
      }
      context.globalCompositeOperation = 'copy'
      context.drawImage(canvas, 0, 0)
      const pixels = context.getImageData(0, 0, capture.width, capture.height)
      const rgba = new Uint32Array(pixels.data.buffer, pixels.data.byteOffset, pixels.width * pixels.height)
      if (rgba.every(pixel => pixel === rgba[0])) throw new Error('The graph canvas contains no visible points')
      return { tick, positions, pixels }
    }
    const submit = (advance: boolean): Promise<CollisionSnapshot> => {
      const result = pending.then(() => measure(advance))
      pending = result.then(() => {}, () => {})
      return result
    }
    return { snapshot: () => submit(false), step: () => submit(true), destroy }
  } catch (error) { destroy(); throw error }
}
