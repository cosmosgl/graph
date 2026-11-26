import type { DeviceInfo } from '@luma.gl/core'
import type { Engine } from '../production-graph-api/frame'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { lineConfig, lineProbes, lineViewport, loadLines, moveEndpoint, type LineCase, type Probe } from './fixture'
import { loadMotion, motionCase, motionProbes, setPhase, type MotionStyle } from './motion'

export type PickResult = Probe & { actual: string }
export type LineSnapshot = { pixels: ImageData; picks: PickResult[] }
export type LineSession = {
  deviceInfo: DeviceInfo;
  measure(state: boolean | number, withPicks?: boolean): Promise<LineSnapshot>;
  measureWidths(widths: Float32Array, probes: Probe[]): Promise<LineSnapshot>;
  destroy(): void;
}

/** Each iframe has its own Cosmos global, document, canvas and event coordinates. */
export async function mountLinePreview (
  parent: HTMLElement, engine: Engine, ratio: 1 | 2, scene: LineCase | typeof motionCase, style: MotionStyle = 'dashed'
): Promise<LineSession> {
  const frame = document.createElement('iframe')
  frame.title = `${engine === 'webgl' ? 'WebGL' : 'WebGPU'} ${scene} links`
  frame.tabIndex = -1
  frame.width = String(lineViewport.width)
  frame.height = String(lineViewport.height)
  frame.style.cssText = 'border:0;display:block;width:256px;height:160px;max-width:none'
  parent.append(frame)
  const doc = frame.contentDocument!
  const win = doc.defaultView!
  doc.body.style.margin = '0'
  const host = doc.createElement('div')
  host.style.cssText = 'position:relative;width:100vw;height:100vh'
  doc.body.append(host)
  let dispose = (): void => frame.remove()
  try {
    const GRAPH = await loadGraphPackage(engine, doc)
    let onPick: ((value: string) => void) | undefined
    let hovered: number | undefined
    const graph = new GRAPH(host, {
      ...lineConfig(scene === motionCase ? 'straight' : scene, ratio),
      onLinkClick: (id): void => onPick?.(`Link ${id}`),
      onPointClick: (id): void => onPick?.(`Point ${id}`),
      onBackgroundClick: (): void => onPick?.('Background'),
      onLinkMouseOver: (id): void => { hovered = id },
      onLinkMouseOut: (): void => { hovered = undefined },
    })
    dispose = (): void => { graph.destroy(); frame.remove() }
    await graph.ready
    const deviceInfo = graph.simulation.device?.info
    if (deviceInfo?.type !== engine) throw new Error(`Requested ${engine}, Graph reports ${deviceInfo?.type}`)
    if (scene === motionCase) loadMotion(graph, style)
    else loadLines(graph, scene)
    const canvas = host.querySelector('canvas')!
    const copy = doc.createElement('canvas')
    copy.width = lineViewport.width * ratio
    copy.height = lineViewport.height * ratio
    const ctx = copy.getContext('2d', { willReadFrequently: true })!
    const mouse = ([x, y]: [number, number]): PointerEventInit => {
      const rect = canvas.getBoundingClientRect()
      return {
        clientX: rect.left + x,
        clientY: rect.top + y,
        bubbles: true,
        pointerId: 1,
        isPrimary: true,
        pointerType: 'mouse',
        view: win,
      }
    }
    const movePointer = async (xy: [number, number], expected: number | undefined): Promise<void> => {
      const init = mouse(xy)
      graph.renderOneFrame()
      canvas.dispatchEvent(new win.PointerEvent('pointerenter', init))
      canvas.dispatchEvent(new win.PointerEvent('pointermove', init))
      canvas.dispatchEvent(new win.MouseEvent('mousemove', init))
      const deadline = performance.now() + 8000
      let draws = 0
      // The WebGL package waits several host frames before issuing a hover pick.
      while (draws < 8 || performance.now() < deadline) {
        if (hovered === expected) return
        graph.renderOneFrame()
        draws++
        // Read a canvas pixel so offscreen software rendering completes the draw
        // and the preceding asynchronous hover readback can signal its fence.
        if (draws % 6 === 0) {
          ctx.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1)
          ctx.getImageData(0, 0, 1, 1)
        }
        // A preview outside the viewport can have its animation frames suspended.
        await new Promise<void>(resolve => window.setTimeout(resolve, 16))
      }
      throw new Error(`${engine} did not hover ${expected === undefined ? 'the background' : `link ${expected}`} at ${xy.join(', ')} after ${draws} draws`)
    }
    const hover = async (xy: [number, number]): Promise<void> => {
      // Reacquire the link at its new location, even if the preceding frame
      // ended with the same link highlighted.
      if (hovered !== undefined) await movePointer([200, 106], undefined)
      await movePointer(xy, 0)
    }
    const click = async (probe: Probe): Promise<PickResult> => {
      const init = mouse(probe.xy)
      const actual = await new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(`${engine} did not dispatch a click for ${probe.label}`)), 5000)
        onPick = (value): void => { window.clearTimeout(timeout); resolve(value) }
        canvas.dispatchEvent(new win.PointerEvent('pointerdown', { ...init, buttons: 1 }))
        canvas.dispatchEvent(new win.PointerEvent('pointerup', init))
        canvas.dispatchEvent(new win.MouseEvent('click', init))
      }).finally(() => { onPick = undefined })
      return { ...probe, actual }
    }
    async function capture (probes: Probe[]): Promise<LineSnapshot> {
      graph.renderOneFrame()
      if (canvas.width !== copy.width || canvas.height !== copy.height) throw new Error(`Unexpected ${engine} drawing buffer dimensions`)
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(canvas, 0, 0)
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height)
      const picks: PickResult[] = []
      for (const probe of probes) picks.push(await click(probe))
      return { pixels, picks }
    }
    return {
      deviceInfo,
      destroy: dispose,
      measureWidths (widths, probes): Promise<LineSnapshot> {
        graph.setLinkWidths(widths)
        graph.render(undefined, 0)
        return capture(probes)
      },
      async measure (state, withPicks = true): Promise<LineSnapshot> {
        let probes: Probe[]
        if (scene === motionCase && typeof state === 'number') {
          setPhase(graph, state, ratio)
          probes = withPicks ? motionProbes(state, ratio, style) : []
        } else if (scene !== motionCase && typeof state === 'boolean') {
          moveEndpoint(graph, state)
          probes = lineProbes(scene, state)
        } else throw new Error('Expected a phase for the motion sweep or an endpoint choice for a static fixture')
        if (scene === 'hover') await hover(probes[0]!.xy)
        const snapshot = await capture(probes)
        if (scene === 'hover') { await hover(probes[0]!.xy); graph.renderOneFrame() }
        return snapshot
      },
    }
  } catch (error) { dispose(); throw error }
}
