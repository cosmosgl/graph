import type { DeviceInfo } from '@luma.gl/core'
import type { Graph } from '../../../../../dist/index.js'
import { lineConfig, lineViewport } from '../production-lines/fixture'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

type Probe = 'point' | 'witness' | 'stroke' | 'background'
type Control = { pixels: ImageData; pick: string; rgb: number[] }
export type CrossingSample = {
  phase: 'before' | 'during' | 'after';
  time: number;
  strokeY: number;
  pixels: ImageData;
  colors: Record<Probe, number[]>;
  picks: Record<Probe, string>;
  linkOnly: Control;
}

const { width, height } = lineViewport
const phases = ['before', 'during', 'after'] as const

function positions (endpointY: number, withPoint: boolean): Float32Array {
  // CSS endpoints (32, y) and (224, y), with an unrelated point at (128, 80).
  const y = 256 + height / 2 - endpointY
  const xy = [160, y, 352, y]
  if (withPoint) xy.push(256, 256)
  return Float32Array.from(xy)
}

type CrossingFrame = Pick<CrossingSample, 'pixels' | 'phase' | 'time' | 'strokeY'> & {
  click(x: number, y: number): Promise<string>;
  rgb(x: number, y: number): number[];
}

/** Each foreground uses the same link-only control, camera, endpoints, clock and public pointer events. */
export async function replayCurve<C, S> (engine: Engine, ratio: 1 | 2, scene: {
  configurePoint?(graph: Graph): void;
  control(frame: CrossingFrame): Promise<C>;
  sample(frame: CrossingFrame, control: C): Promise<S>;
}): Promise<{ deviceInfo: DeviceInfo; samples: S[] }> {
  const frame = document.createElement('iframe')
  frame.title = `${engine} curved link crossing`
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
      ...lineConfig('curved', ratio),
      backgroundColor: '#000',
      linkDefaultColor: '#0f0',
      linkDefaultWidth: 8,
      curvedLinkControlPointDistance: 0.25,
      transitionEasing: 'linear',
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
      let now = win.performance.now()
      Object.defineProperty(win.performance, 'now', { configurable: true, value: () => now })
      const controls: C[] = []
      const samples: S[] = []
      for (const withPoint of [false, true]) {
        graph.setPointPositions(positions(72, withPoint), true)
        graph.setLinks(Float32Array.of(0, 1))
        graph.setPointSizes(withPoint ? Float32Array.of(6, 6, 24) : Float32Array.of(6, 6))
        const colors = [0.6, 0.6, 0.6, 1, 0.6, 0.6, 0.6, 1]
        if (withPoint) colors.push(1, 0, 0, 1)
        graph.setPointColors(Float32Array.from(colors))
        if (withPoint) scene.configurePoint?.(graph)
        graph.render(undefined, 0)
        graph.pause()
        graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
        const start = now
        graph.setPointPositions(positions(136, withPoint), true)
        graph.render(undefined, 1000)
        for (const [i, phase] of phases.entries()) {
          const time = i * 500
          now = start + time
          graph.renderOneFrame()
          if (canvas.width !== copy.width || canvas.height !== copy.height) throw new Error(`Unexpected canvas dimensions for ${engine}`)
          context.drawImage(canvas, 0, 0)
          const pixels = context.getImageData(0, 0, copy.width, copy.height)
          const rgb = (x: number, y: number): number[] => {
            const offset = 4 * (y * ratio * copy.width + x * ratio)
            return Array.from(pixels.data.subarray(offset, offset + 3))
          }
          // At t=1/4 on this quadratic, the left shoulder is 18 CSS px above its endpoints.
          const capture = { phase, time, pixels, strokeY: 54 + i * 32, click, rgb }
          if (withPoint) samples.push(await scene.sample(capture, controls[i]!))
          else controls.push(await scene.control(capture))
        }
      }
      return { deviceInfo, samples }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}

export function runCurvedCrossing (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: CrossingSample[] }> {
  return replayCurve<Control, CrossingSample>(engine, ratio, {
    control: async ({ pixels, click, rgb }) => ({ pixels, pick: await click(128, 80), rgb: rgb(128, 80) }),
    sample: async ({ phase, time, strokeY, pixels, click, rgb }, linkOnly) => ({
      phase,
      time,
      strokeY,
      pixels,
      linkOnly,
      picks: { point: await click(128, 80), witness: await click(160, 83), stroke: await click(80, strokeY), background: await click(16, 16) },
      colors: { point: rgb(128, 80), witness: rgb(160, 83), stroke: rgb(80, strokeY), background: rgb(16, 16) },
    }),
  })
}
