import type { DeviceInfo } from '@luma.gl/core'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

export type PointStyleSample = {
  phase: string;
  pixels: ImageData;
  requestedSize: number;
  size: number;
  pointSpan: number;
  pointRgb: number[];
  linkRgb: number[];
  picks: { center: string; edge: string; outerEdge: string; link: string; control: string };
  selections: { offset: number; rectangle: number[]; lasso: number[] }[];
}

const width = 224
const height = 160

/** Replay point-only setters using each package's public draw, click and area-selection paths. */
export async function runPointStyleUpdates (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: PointStyleSample[] }> {
  const frame = document.createElement('iframe')
  frame.title = `${engine} point styles`
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
      spaceSize: 512,
      pixelRatio: ratio,
      enableRenderLoop: false,
      enableSimulation: false,
      rescalePositions: false,
      enableZoom: false,
      enableDrag: false,
      fitViewOnInit: false,
      backgroundColor: '#000',
      pointDefaultSize: 8,
      linkDefaultWidth: 4,
      linkVisibilityMinTransparency: 1,
      linkColorInterpolateFromEndpoints: true,
      onPointClick: id => onPick?.(`Point ${id}`),
      onLinkClick: id => onPick?.(`Link ${id}`),
      onBackgroundClick: () => onPick?.('Background'),
    })
    try {
      await graph.ready
      const deviceInfo = graph.simulation.device?.info
      if (deviceInfo?.type !== engine) throw new Error(`Point-style replay requested ${engine} but got ${deviceInfo?.type}`)
      // Two links at y=48 and y=112. Only the point at (48,48) changes.
      graph.setPointPositions(Float32Array.of(192, 288, 320, 288, 192, 224, 320, 224), true)
      graph.setLinks(Float32Array.of(0, 1, 2, 3))
      const colors = Float32Array.of(1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1)
      const sizes = Float32Array.of(8, 8, 8, 8)
      const setColor = (r: number, g: number, b: number): void => { colors.set([r, g, b]); graph.setPointColors(colors) }
      const setSize = (size: number): void => { sizes[0] = size; graph.setPointSizes(sizes) }
      graph.setPointColors(colors)
      graph.setPointSizes(sizes)
      graph.render(undefined, 0)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
      let now = win.performance.now()
      Object.defineProperty(win.performance, 'now', { configurable: true, value: () => now })
      const canvas = host.querySelector('canvas')!
      const copy = doc.createElement('canvas')
      copy.width = width * ratio; copy.height = height * ratio
      const context = copy.getContext('2d', { willReadFrequently: true })!
      const click = async (x: number, y: number): Promise<string> => {
        const rect = canvas.getBoundingClientRect()
        const input = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, view: win, pointerType: 'mouse', pointerId: 1, isPrimary: true }
        return new Promise<string>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(`${engine} did not deliver a click at ${x}, ${y}`)), 5000)
          onPick = (value): void => { window.clearTimeout(timer); resolve(value) }
          canvas.dispatchEvent(new win.PointerEvent('pointerdown', { ...input, buttons: 1 }))
          canvas.dispatchEvent(new win.PointerEvent('pointerup', input))
          canvas.dispatchEvent(new win.MouseEvent('click', input))
        }).finally(() => { onPick = undefined })
      }
      const samples: PointStyleSample[] = []
      const sample = async (phase: string, advance = 0): Promise<void> => {
        now += advance
        graph.renderOneFrame()
        if (canvas.width !== copy.width || canvas.height !== copy.height) throw new Error(`Unexpected canvas size for ${engine}`)
        context.drawImage(canvas, 0, 0)
        const pixels = context.getImageData(0, 0, copy.width, copy.height)
        const rgb = (x: number, y: number): number[] => {
          const at = 4 * (y * ratio * copy.width + x * ratio)
          return Array.from(pixels.data.subarray(at, at + 3))
        }
        let pointSpan = 0
        for (let y = 16 * ratio; y < 80 * ratio; y++) {
          const at = 4 * (y * copy.width + 48 * ratio)
          if (Math.max(pixels.data[at]!, pixels.data[at + 1]!, pixels.data[at + 2]!) > 32) pointSpan++
        }
        const picks = {
          center: await click(48, 48),
          edge: await click(48, 68),
          outerEdge: await click(48, 70),
          link: await click(112, 48),
          control: await click(48, 112),
        }
        const selections: PointStyleSample['selections'] = []
        // Both regions contain point 2. Their top edges straddle point 0's center
        // and the radii reached during shrinking (12 px) and regrowth (16 px).
        for (const offset of [-8, 10, 14, 18]) {
          const top = 48 + offset
          const rectangle = await graph.findPointsInRectAsync([[36, top], [60, 120]])
          const lasso = await graph.findPointsInPolygonAsync([[36, top], [60, top], [68, 120], [28, 120]])
          if (rectangle === null || lasso === null) throw new Error(`${engine} could not read area selection at ${offset} px during ${phase}`)
          selections.push({ offset, rectangle, lasso })
        }
        samples.push({
          phase,
          pixels,
          requestedSize: sizes[0]!,
          size: graph.getPointRadiusByIndex(0)!,
          pointSpan,
          pointRgb: rgb(48, 48),
          linkRgb: rgb(112, 48),
          picks,
          selections,
        })
      }
      await sample('Initial')
      setColor(0, 0, 1); graph.render(undefined, 0)
      await sample('Color only')
      setSize(40); graph.render(undefined, 0)
      await sample('Size only')
      setColor(1, 0, 0); setSize(8); graph.render(undefined, 1000)
      await sample('Shrink and recolor')
      await sample('Halfway through shrinking', 500)
      setColor(1, 1, 1); setSize(40); graph.render(undefined, 1000)
      await sample('Interrupt with a larger white point')
      await sample('Halfway through regrowth', 500)
      await sample('Settled', 500)
      return { deviceInfo, samples }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}
