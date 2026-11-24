import type { DeviceInfo } from '@luma.gl/core'
import type { GraphConfig } from '../../../../../dist/index.js'
import type { Engine } from '../production-graph-api/frame'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { forceConfig, loadForce, pointer, viewport, type ForceCase } from './fixture'
import { isScaleCase } from './scale-fixture'

type PreviewOptions = {
  config?: GraphConfig;
  onPick?: (id: string) => void;
}

export type ForceSession = {
  device: DeviceInfo;
  advance(steps: number): Promise<Float32Array>;
  project(x: number, y: number): [number, number];
  linkEndpoints(id: number): number[];
  readPixel(x: number, y: number): number[];
  click(x: number, y: number): Promise<string>;
  destroy(): void;
}

async function mountForce (host: HTMLDivElement, engine: Engine, fixture: ForceCase, options: PreviewOptions): Promise<ForceSession> {
  const doc = host.ownerDocument
  const GRAPH = await loadGraphPackage(engine, doc)
  const view = doc.defaultView!
  let reportClick: ((result: string) => void) | undefined
  function picked (id: string): void {
    options.onPick?.(id)
    reportClick?.(id)
  }
  const callbacks: GraphConfig = fixture === 'combined' || isScaleCase(fixture)
    ? {
      onLinkClick: id => picked(`Link ${id}`),
      onPointClick: id => picked(`Point ${id}`),
      onBackgroundClick: () => picked('Background'),
    }
    : {}
  const graph = new GRAPH(host, { ...forceConfig(fixture), ...options.config, ...callbacks })
  try {
    await graph.ready
    const device = graph.simulation.device?.info
    if (device?.type !== engine) throw new Error(`Expected ${engine} but received ${device?.type}`)
    loadForce(graph, fixture)
    const canvas = host.querySelector('canvas')!
    let tick = 0
    let reader: CanvasRenderingContext2D | null = null
    function pointerInput (held: boolean): void {
      const [x, y] = graph.spaceToScreenPosition(pointer)
      const rect = canvas.getBoundingClientRect()
      const payload = {
        view,
        bubbles: true,
        isPrimary: true,
        pointerType: 'mouse',
        pointerId: 1,
        clientX: x + rect.left,
        clientY: y + rect.top,
        button: held ? -1 : 2,
        buttons: held ? 2 : 0,
      }
      // Real mouse movement delivers a primary PointerEvent and its compatibility MouseEvent.
      canvas.dispatchEvent(new view.PointerEvent(held ? 'pointermove' : 'pointerup', payload))
      canvas.dispatchEvent(new view.MouseEvent(held ? 'mousemove' : 'mouseup', payload))
    }
    return {
      device,
      project: (x, y) => graph.spaceToScreenPosition([x, y]),
      linkEndpoints: id => graph.getConnectedPointIndices(id),
      async advance (steps: number): Promise<Float32Array> {
        if (fixture === 'mouse' && steps && tick < 4) pointerInput(true)
        for (let i = 0; i < steps; i++) {
          // The reference applies held-button repulsion in a paused frame as well as a manual step.
          if (fixture === 'gravity' && !tick) {
            graph.unpause()
            graph.renderOneFrame()
            graph.pause()
          } else if (fixture === 'mouse' && tick % 2) graph.renderOneFrame()
          else graph.step()
          tick++
          if (fixture === 'mouse' && tick === 4) pointerInput(false)
        }
        if (fixture === 'mouse' && tick < 4) pointerInput(false)
        graph.renderOneFrame()
        return await graph.getPointPositionsAsync()
      },
      readPixel (x, y): number[] {
        reader ??= doc.createElement('canvas').getContext('2d', { willReadFrequently: true })
        if (!reader) throw new Error('Cannot read the rendered graph')
        graph.renderOneFrame()
        reader.globalCompositeOperation = 'copy'
        reader.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1)
        return [...reader.getImageData(0, 0, 1, 1).data]
      },
      async click (x, y): Promise<string> {
        const rect = canvas.getBoundingClientRect()
        const init = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', view }
        return await new Promise<string>((resolve, reject) => {
          const timer = view.setTimeout(() => reject(new Error(`No click callback at ${x}, ${y}`)), 5000)
          reportClick = (id): void => { view.clearTimeout(timer); resolve(id) }
          canvas.dispatchEvent(new view.PointerEvent('pointerdown', { ...init, buttons: 1 }))
          canvas.dispatchEvent(new view.PointerEvent('pointerup', init))
          canvas.dispatchEvent(new view.MouseEvent('click', init))
        }).finally(() => { reportClick = undefined })
      },
      destroy: (): void => graph.destroy(),
    }
  } catch (error) {
    graph.destroy()
    throw error
  }
}

/** Construct the same application in a separate package realm for each engine. */
export async function createForcePreview (parent: HTMLElement, engine: Engine, fixture: ForceCase, options: PreviewOptions = {}): Promise<ForceSession> {
  const frame = document.createElement('iframe')
  frame.title = `${engine === 'webgl' ? 'WebGL' : 'WebGPU'} force simulation`
  frame.width = String(viewport.width)
  frame.height = String(viewport.height)
  frame.style.cssText = 'display:block;border:0;max-width:none'
  if (fixture !== 'combined' && !isScaleCase(fixture)) {
    frame.style.pointerEvents = 'none'
    frame.tabIndex = -1
    frame.inert = true
  }
  parent.append(frame)
  const doc = frame.contentDocument!
  doc.body.style.margin = '0'
  const host = doc.createElement('div')
  host.style.cssText = 'position:relative;width:100vw;height:100vh'
  doc.body.append(host)
  try {
    const session = await mountForce(host, engine, fixture, options)
    return { ...session, destroy (): void { session.destroy(); frame.remove() } }
  } catch (error) { frame.remove(); throw error }
}
