// Built from the unchanged workspace engine; its imports resolve root luma v9.
import type { Graph } from '../../../../../dist/index.js'
import { workload } from '../integrated-webgpu/data'
import { graphPalette, graphRgba } from '../../runtime/palette'
import { styles, type Scene } from './styles'
const nextFrame = async (): Promise<number> => await new Promise(resolve => requestAnimationFrame(resolve))
export async function createProduction (host: HTMLDivElement): Promise<{
  graph: Graph; canvas: HTMLCanvasElement; info: string; tick: number; readonly selected: number | undefined; errors: string[];
  feedback: { kind: string; id?: number; ms: number }[];
  replace(scene: Scene): Promise<void>; style(alternate: boolean): void; frame(simulate: boolean): Promise<void>;
  positions(): Float32Array; fit(): void; snapshot(ids?: boolean): Uint8Array; destroy(): void;
}> {
  let count = 34; let alternate = false; let selected: number | undefined; let tick = 0; let dead = false
  const errors: string[] = []
  const feedback: { kind: string; id?: number; ms: number }[] = []
  const GRAPH = (window as unknown as { [key: string]: { [key: string]: typeof Graph } }).Cosmos.Graph
  const graph = new GRAPH(host, {
    enableRenderLoop: false,
    enableDrag: true,
    enableSimulationDuringZoom: false,
    fitViewOnInit: false,
    transitionDuration: 0,
    rescalePositions: false,
    randomSeed: 29471,
    backgroundColor: graphPalette.background,
    pointDefaultColor: graphPalette.point,
    pointDefaultSize: 6,
    renderHoveredPointRing: false,
    scalePointsOnZoom: false,
    scaleLinksOnZoom: false,
    linkOpacity: 1,
    linkVisibilityMinTransparency: 1,
    pointOcclusionCulling: false,
    simulationGravity: 0.25,
    simulationCenter: 0.1,
    simulationRepulsion: 1,
    simulationRepulsionSamples: 8,
    simulationLinkSpring: 1,
    simulationLinkDistance: 10,
    simulationLinkDistRandomVariationRange: [1, 1],
    simulationFriction: 0.85,
    simulationDecay: 5000,
    simulationRepulsionFromMouse: 0,
    simulationCollision: 0,
    onSimulationTick: (): void => { tick++ },
    onPointClick: (id, _position, event): void => {
      selected = id; applyStyle(alternate)
      feedbackCompletion('click', event.timeStamp, id).catch(e => { if (!dead) errors.push(String(e)) })
    },
    onBackgroundClick: (event): void => {
      selected = undefined; applyStyle(alternate)
      feedbackCompletion('background', event.timeStamp).catch(e => { if (!dead) errors.push(String(e)) })
    },
    onDrag: (event): void => { feedbackCompletion('drag', event.sourceEvent.timeStamp).catch(e => { if (!dead) errors.push(String(e)) }) },
  })
  const applyStyle = (value: boolean): void => {
    alternate = value; const s = styles(count, value)
    if (selected !== undefined) { s.colors.set(graphRgba.pinned, selected * 4); s.sizes[selected] += 2 }
    graph.setPointColors(s.colors); graph.setPointSizes(s.sizes)
    graph.setConfigPartial({ linkDefaultColor: s.link, linkDefaultWidth: s.width }); graph.render(undefined, 0)
  }
  const complete = async (): Promise<void> => {
    const device = graph.simulation.device!; const fence = device.createFence(); let timer: ReturnType<typeof setTimeout> | undefined
    try {
      device.submit()
      await Promise.race([fence.signaled, new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('WebGL completion timeout')), 5000)
      })])
      if (device.isLost) throw new Error('Production WebGL device lost')
    } finally { clearTimeout(timer); fence.destroy() }
  }
  const feedbackCompletion = async (kind: string, start: number, id?: number): Promise<void> => {
    // An event-driven host frame guarantees the setter/drag update is submitted before completion and presentation opportunity.
    // This may add one simulation tick; interaction is outside the fixed timing windows.
    await nextFrame(); if (dead) return
    graph.renderOneFrame(); await complete(); await nextFrame(); if (!dead) feedback.push({ kind, id, ms: performance.now() - start })
  }
  try {
    await graph.ready
    const canvas = host.querySelector('canvas')!
    const api = {
      graph,
      canvas,
      feedback,
      errors,
      get selected (): number | undefined { return selected },
      info: `production Cosmos / luma v9 · ${JSON.stringify(graph.simulation.device!.info)} · ${navigator.userAgent}`,
      get tick (): number { return tick },
      async replace (scene: Scene): Promise<void> {
        const data = workload(scene, 32); count = data.graph.points.length / 4; tick = 0; selected = undefined
        // Preserve production's 4096-unit reference length and put the same relative positions around its world origin.
        graph.pause()
        graph.setPointPositions(Float32Array.from({ length: count * 2 }, (_, i) => data.input.points[Math.floor(i / 2) * 4 + i % 2] + 2048), true)
        graph.setLinks(data.graph.links); graph.setLinkStrength(data.graph.weights)
        api.style(false); graph.render(1, 0); graph.pause(); await api.frame(false); api.fit(); await api.frame(false)
      },
      style: (value: boolean): void => { selected = undefined; applyStyle(value) },
      async frame (simulate: boolean): Promise<void> {
        if (dead) return
        if (simulate) graph.unpause(); else graph.pause()
        graph.renderOneFrame(); await complete()
      },
      positions (): Float32Array {
        const xy = graph.getPointPositionsArray(); const result = new Float32Array(xy.length * 2)
        for (let i = 0; i < xy.length / 2; i++) result.set([xy[i * 2] - 2048, xy[i * 2 + 1] - 2048, graph.isPointPinned(i) ? 1 : 0, 0], i * 4)
        return result
      },
      fit (): void { graph.fitView(0, 0.1, false) },
      snapshot (ids = false): Uint8Array {
        const device = graph.simulation.device!; const { width, height } = canvas
        const texture = device.createTexture({ width, height, format: 'rgba8unorm' })
        const framebuffer = device.createFramebuffer({ width, height, colorAttachments: [texture], depthStencilAttachment: 'depth24plus' })
        try {
          const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: 1 })
          graph.drawToRenderPass(pass, ids ? { links: false, picking: { alpha: 1 } } : undefined); pass.end(); device.submit()
          const raw = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array; const out = new Uint8Array(raw.length)
          for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
          return out
        } finally { framebuffer.destroy(); texture.destroy() }
      },
      destroy (): void { dead = true; graph.destroy() },
    }
    await api.replace('karate'); return api
  } catch (e) { dead = true; graph.destroy(); throw e }
}
export type Production = Awaited<ReturnType<typeof createProduction>>
