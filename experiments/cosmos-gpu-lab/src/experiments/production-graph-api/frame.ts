import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { loadManualStep, manualStepConfig } from './manual-step-fixture'

export type Engine = 'webgl' | 'webgpu'
export type PublicGraphSession = {
  positions(): Promise<Float32Array>;
  step(): Promise<Float32Array>;
  screen(point: [number, number]): [number, number];
  destroy(): void;
}

export async function mountGraph (host: HTMLDivElement, engine: Engine): Promise<PublicGraphSession> {
  const frame = host.ownerDocument
  const GRAPH = await loadGraphPackage(engine, frame)
  const selection = frame.createElement('output')
  selection.setAttribute('aria-live', 'polite')
  selection.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:1;color:white;font:14px system-ui'
  host.append(selection)
  const graph = new GRAPH(host, {
    ...manualStepConfig,
    onPointClick: (index): void => { selection.textContent = `Selected point ${index}` },
    onBackgroundClick: (): void => { selection.textContent = 'Background' },
  })
  frame.defaultView!.addEventListener('pagehide', () => graph.destroy(), { once: true })
  try {
    loadManualStep(graph)
    await graph.ready
    const actual = graph.simulation.device?.info.type
    if (actual !== engine) throw new Error(`Requested ${engine} but the Graph created a ${actual} device`)
    return {
      positions: () => graph.getPointPositionsAsync(),
      async step (): Promise<Float32Array> { graph.step(); return await graph.getPointPositionsAsync() },
      screen: (point: [number, number]) => graph.spaceToScreenPosition(point),
      destroy: () => graph.destroy(),
    }
  } catch (error) { graph.destroy(); throw error }
}
