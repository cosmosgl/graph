import type { DeviceInfo } from '@luma.gl/core'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

type Phase = 'initial' | 'remove' | 'restore' | 'snap-remove' | 'snap-restore'
type Point = [number, number]
const anchor: Point = [192, 96]
const original: Point = [48, 96]
const restored: Point = [80, 96]
const control: Point = [128, 40]
const linkProbe: Point = [144, 96]

export type SparseSample = {
  phase: Phase;
  time: number;
  pixels: ImageData;
  picks: { point: string; link: string; anchor: string; control: string };
  midpointPicks?: string[];
  survivors: number[];
  pointSpan: number;
  pointBounds: number[] | null;
  pointRgb: number[];
  linkRgb: number[];
}

function positions (slot: Point): Float32Array {
  return Float32Array.from([anchor, slot, control].flatMap(([x, y]) => [256 + x - 128, 256 - y + 80]))
}

/** Both packages see the same positions, pointer events and iframe clock. The application clock keeps running. */
export async function runSparseTransition (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: SparseSample[] }> {
  const frame = document.createElement('iframe')
  frame.title = `${engine} sparse point replay`
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:0;top:0;width:256px;height:160px;border:0;opacity:0;pointer-events:none'
  document.body.append(frame)
  const doc = frame.contentDocument!
  const win = doc.defaultView!
  doc.body.style.margin = '0'
  const host = doc.createElement('div')
  host.style.cssText = 'position:relative;width:256px;height:160px'
  doc.body.append(host)
  try {
    const GRAPH = await loadGraphPackage(engine, doc)
    let onPick: ((value: string) => void) | undefined
    const graph = new GRAPH(host, {
      spaceSize: 512,
      pixelRatio: ratio,
      enableRenderLoop: false,
      enableSimulation: false,
      enableDrag: false,
      enableZoom: false,
      fitViewOnInit: false,
      rescalePositions: false,
      backgroundColor: '#000',
      pointDefaultSize: 24,
      pointDefaultColor: '#f00',
      linkDefaultWidth: 4,
      linkDefaultColor: '#0f0',
      linkVisibilityMinTransparency: 1,
      hoveredLinkWidthIncrease: 0,
      onPointClick: id => onPick?.(`Point ${id}`),
      onLinkClick: id => onPick?.(`Link ${id}`),
      onBackgroundClick: () => onPick?.('Background'),
    })
    try {
      await graph.ready
      const deviceInfo = graph.simulation.device?.info
      if (deviceInfo?.type !== engine) throw new Error(`Sparse replay requested ${engine} but got ${deviceInfo?.type}`)
      graph.setPointPositions(positions(original))
      graph.setLinks(Float32Array.of(1, 0))
      graph.render(undefined, 0)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [256, 160])
      const canvas = host.querySelector('canvas')!
      const copy = doc.createElement('canvas')
      copy.width = 256 * ratio
      copy.height = 160 * ratio
      const context = copy.getContext('2d', { willReadFrequently: true })!
      const click = async ([x, y]: Point): Promise<string> => {
        const rect = canvas.getBoundingClientRect()
        const event = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, view: win, pointerType: 'mouse', pointerId: 1, isPrimary: true }
        return await new Promise<string>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(`${engine} timed out picking at ${[x, y]}`)), 5000)
          onPick = (value): void => { window.clearTimeout(timer); resolve(value) }
          canvas.dispatchEvent(new win.PointerEvent('pointerdown', { ...event, buttons: 1 }))
          canvas.dispatchEvent(new win.PointerEvent('pointerup', event))
          canvas.dispatchEvent(new win.MouseEvent('click', event))
        }).finally(() => { onPick = undefined })
      }
      let now = win.performance.now()
      Object.defineProperty(win.performance, 'now', { configurable: true, value: () => now })
      const samples: SparseSample[] = []
      const sample = async (phase: Phase, time: number, point: Point): Promise<void> => {
        graph.renderOneFrame()
        if (canvas.width !== copy.width || canvas.height !== copy.height) throw new Error(`Unexpected drawing buffer size for ${engine}`)
        context.drawImage(canvas, 0, 0)
        const pixels = context.getImageData(0, 0, copy.width, copy.height)
        const rgb = ([x, y]: Point): number[] => {
          const i = 4 * (y * ratio * copy.width + x * ratio)
          return Array.from(pixels.data.subarray(i, i + 3))
        }
        let pointSpan = 0
        let left = copy.width
        let top = copy.height
        let right = -1
        let bottom = -1
        for (let y = 0; y < copy.height; y++) {
          if (pixels.data[4 * (y * copy.width + point[0] * ratio)]! > 0) pointSpan++
          // No other red point enters this region. The bounds distinguish a smaller point
          // at the destination from a point that is still travelling there.
          if (y >= 64 * ratio && y < 128 * ratio) {
            for (let x = 16 * ratio; x < 112 * ratio; x++) {
              if (!pixels.data[4 * (y * copy.width + x)]) continue
              left = Math.min(left, x); right = Math.max(right, x)
              top = Math.min(top, y); bottom = Math.max(bottom, y)
            }
          }
        }
        const xy = await graph.getPointPositionsAsync()
        const picks = { point: await click(point), link: await click(linkProbe), anchor: await click(anchor), control: await click(control) }
        let midpointPicks: string[] | undefined
        if (phase === 'restore' && time === 500) {
          // The frozen slot moves from x=48 to x=80. Sample both sides of the center
          // so a pick at the destination alone cannot pass with the wrong center.
          midpointPicks = []
          for (const x of [40, 48, 64, 80, 88]) midpointPicks.push(await click([x, 96]))
        }
        const pointBounds = right >= left ? [left, top, right + 1, bottom + 1] : null
        samples.push({
          phase,
          time,
          pixels,
          picks,
          midpointPicks,
          survivors: [xy[0]!, xy[1]!, xy[4]!, xy[5]!],
          pointSpan,
          pointBounds,
          pointRgb: rgb(point),
          linkRgb: rgb(linkProbe),
        })
      }
      const edit = async (phase: Phase, target: Point, probe: Point, duration: number): Promise<void> => {
        graph.setPointPositions(positions(target))
        graph.render(undefined, duration)
        const start = now
        for (const time of duration ? [0, 500, 1000] : [0]) {
          now = start + time
          await sample(phase, time, probe)
        }
      }
      await sample('initial', 0, original)
      await edit('remove', [NaN, NaN], original, 1000)
      await edit('restore', restored, restored, 1000)
      await edit('snap-remove', [NaN, NaN], restored, 0)
      await edit('snap-restore', original, original, 0)
      return { deviceInfo, samples }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}
