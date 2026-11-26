import type { DeviceInfo } from '@luma.gl/core'
import type { Graph, GraphConfig } from '../../../../../dist/index.js'
import { lineViewport } from '../production-lines/fixture'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

type LinkGraph = {
  graph: Graph;
  deviceInfo: DeviceInfo;
  win: Window;
  capture(): ImageData;
  click(x: number, y: number): Promise<string>;
}

/** Run a crossing against one standalone package, including its canvas and public pointer handlers. */
export async function withLinkGraph<T> (
  engine: Engine, ratio: 1 | 2, config: GraphConfig, run: (context: LinkGraph) => Promise<T>
): Promise<T> {
  const { width, height } = lineViewport
  const frame = document.createElement('iframe')
  frame.title = `${engine} link crossing`
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none`
  document.body.append(frame)
  try {
    const doc = frame.contentDocument!
    const win = doc.defaultView!
    doc.body.style.margin = '0'
    const host = doc.createElement('div')
    host.style.cssText = 'position:relative;width:100vw;height:100vh'
    doc.body.append(host)
    const GRAPH = await loadGraphPackage(engine, doc)
    let onPick: ((result: string) => void) | undefined
    const graph = new GRAPH(host, {
      ...config,
      onPointClick: id => onPick?.(`Point ${id}`),
      onLinkClick: id => onPick?.(`Link ${id}`),
      onBackgroundClick: () => onPick?.('Background'),
    })
    try {
      await graph.ready
      const deviceInfo = graph.simulation.device?.info
      if (deviceInfo?.type !== engine) throw new Error(`Requested ${engine}, Graph reports ${deviceInfo?.type}`)
      const canvas = host.querySelector('canvas')!
      const copy = doc.createElement('canvas')
      copy.width = width * ratio
      copy.height = height * ratio
      const context = copy.getContext('2d', { willReadFrequently: true })!
      context.globalCompositeOperation = 'copy'
      const click = async (x: number, y: number): Promise<string> => {
        const rect = canvas.getBoundingClientRect()
        const event = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, view: win, pointerType: 'mouse', pointerId: 1, isPrimary: true }
        return new Promise<string>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(`${engine} did not dispatch a click at ${x}, ${y}`)), 5000)
          onPick = (id): void => { window.clearTimeout(timer); resolve(id) }
          canvas.dispatchEvent(new win.PointerEvent('pointerdown', { ...event, buttons: 1 }))
          canvas.dispatchEvent(new win.PointerEvent('pointerup', event))
          canvas.dispatchEvent(new win.MouseEvent('click', event))
        }).finally(() => { onPick = undefined })
      }
      function capture (): ImageData {
        if (canvas.width !== copy.width || canvas.height !== copy.height) throw new Error(`Unexpected canvas dimensions for ${engine}`)
        context.drawImage(canvas, 0, 0)
        return context.getImageData(0, 0, copy.width, copy.height)
      }
      return await run({ graph, deviceInfo, win, capture, click })
    } finally { graph.destroy() }
  } finally { frame.remove() }
}
