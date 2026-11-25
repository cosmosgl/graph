import type { DeviceInfo } from '@luma.gl/core'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

export const hoverCursor = [144, 64] as const
const width = 192
const height = 128

export type HoverSample = {
  phase: string;
  pixels: ImageData;
  events: string[];
  ringPixels: number;
  ringPixelsAtCursor: number;
  mouseMoves: number;
}

/** Render both packages with the same single pointer move and subsequent scene changes. */
export async function runStationaryHover (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: HoverSample[] }> {
  const frame = document.createElement('iframe')
  frame.title = `${engine} stationary hover replay`
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
    const events: string[] = []
    let active: number | undefined
    let mouseMoves = 0
    const graph = new GRAPH(host, {
      spaceSize: 512,
      pixelRatio: ratio,
      enableRenderLoop: false,
      enableSimulation: false,
      enableDrag: false,
      fitViewOnInit: false,
      rescalePositions: false,
      scalePointsOnZoom: false,
      backgroundColor: '#000',
      pointDefaultColor: '#f00',
      pointDefaultSize: 20,
      renderHoveredPointRing: true,
      hoveredPointRingColor: '#0f0',
      onPointMouseOver: (id): void => { events.push(`over ${id}`); active = id },
      onPointMouseOut: (): void => { events.push(`out ${active}`); active = undefined },
      onMouseMove: (): void => { mouseMoves++ },
    })
    try {
      await graph.ready
      const deviceInfo = graph.simulation.device?.info
      if (deviceInfo?.type !== engine) throw new Error(`Hover replay requested ${engine} but got ${deviceInfo?.type}`)
      const canvas = host.querySelector('canvas')!
      const copy = doc.createElement('canvas')
      copy.width = width * ratio
      copy.height = height * ratio
      const context = copy.getContext('2d', { willReadFrequently: true })!
      const samples: HoverSample[] = []
      // At identity, (256, 256) sits at the center of the canvas. Both points share the cursor's y.
      const movePoints = (firstX: number, secondX: number): void => {
        graph.setPointPositions(Float32Array.of(256 + firstX - width / 2, 256, 256 + secondX - width / 2, 256), true)
        graph.render(undefined, 0)
      }
      const sample = async (phase: string): Promise<void> => {
        // Drive the public frame loop past WebGL's hover throttle and let both asynchronous
        // picks complete. Holding the same geometry over these frames also exposes duplicate callbacks.
        for (let i = 0; i < 10; i++) {
          graph.renderOneFrame()
          await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
        }
        graph.renderOneFrame()
        if (canvas.width !== copy.width || canvas.height !== copy.height) throw new Error(`Unexpected canvas size for ${engine}`)
        context.drawImage(canvas, 0, 0)
        const pixels = context.getImageData(0, 0, copy.width, copy.height)
        let ringPixels = 0
        let ringPixelsAtCursor = 0
        for (let y = 0; y < copy.height; y++) {
          for (let x = 0; x < copy.width; x++) {
            // Only the hover ring contributes green. Exclude near-zero antialiasing fringes.
            if (pixels.data[4 * (y * copy.width + x) + 1]! <= 16) continue
            ringPixels++
            const distance = Math.hypot((x + 0.5) / ratio - hoverCursor[0], (y + 0.5) / ratio - hoverCursor[1])
            if (distance >= 9 && distance <= 14) ringPixelsAtCursor++
          }
        }
        samples.push({ phase, pixels, events: [...events], ringPixels, ringPixelsAtCursor, mouseMoves })
      }
      movePoints(48, 120)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
      graph.renderOneFrame()
      const rect = canvas.getBoundingClientRect()
      const input = { clientX: rect.left + hoverCursor[0], clientY: rect.top + hoverCursor[1], view: win, isPrimary: true, pointerType: 'mouse', pointerId: 1 }
      // An actual mouse movement delivers a pointer event and its compatibility mouse event.
      canvas.dispatchEvent(new win.PointerEvent('pointerenter', input))
      canvas.dispatchEvent(new win.PointerEvent('pointermove', { ...input, bubbles: true }))
      canvas.dispatchEvent(new win.MouseEvent('mousemove', { ...input, bubbles: true }))
      await sample('Cursor parked')
      movePoints(144, 120)
      await sample('Point 0 moves under cursor')
      await sample('Point 0 stays')
      movePoints(48, 144)
      await sample('Point 1 replaces point 0')
      movePoints(48, 120)
      await sample('Point 1 moves away')
      graph.setZoomLevel(2, 0, false)
      await sample('Zoom brings point 1 under cursor')
      graph.setZoomLevel(1, 0, false)
      await sample('Zoom moves point 1 away')
      graph.setZoomLevel(2, 0, false)
      await sample('Zoom returns point 1')
      canvas.dispatchEvent(new win.PointerEvent('pointerleave', input))
      canvas.dispatchEvent(new win.MouseEvent('mouseleave', input))
      await sample('Cursor leaves')
      return { deviceInfo, samples }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}
