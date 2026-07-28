import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'
import { generateMeshData } from '../generate-mesh-data'

/**
 * cosmos.gl renders on demand: frames run only while something visual can
 * change (simulation, transitions, zoom, drag, hover, resize) and stop
 * entirely when the scene is static. This story overlays a frame counter so
 * you can watch rendering go idle after the simulation decays, and resume on
 * hover, zoom, pan, drag, or window resize.
 */
export const onDemandRendering = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  // Count requestAnimationFrame callbacks to visualize when cosmos.gl actually
  // renders. Patched before the graph is created so its frames are counted.
  let frameCount = 0
  const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    originalRequestAnimationFrame((now) => {
      frameCount += 1
      callback(now)
    })

  const { pointPositions, links, pointColors } = generateMeshData(40, 30, 15, 1.0)
  const { div, graph } = createCosmos({
    pointPositions,
    links,
    pointColors,
    // Let the simulation actually end — the shared story config uses a decay
    // so large the simulation would run (and render) practically forever.
    simulationDecay: 1000,
  })

  const counter = document.createElement('div')
  counter.style.cssText = 'position:absolute;top:16px;left:16px;padding:8px 12px;font:12px monospace;' +
    'color:#fff;background:rgba(0,0,0,0.6);border-radius:4px;pointer-events:none;z-index:1'
  div.style.position = 'relative'
  div.appendChild(counter)

  // The overlay updates on an interval timer (not requestAnimationFrame) so it
  // keeps reporting while cosmos.gl is idle and renders nothing.
  let lastCount = 0
  const intervalId = window.setInterval(() => {
    const framesPerSecond = (frameCount - lastCount) * 2
    lastCount = frameCount
    counter.textContent = `frames rendered: ${frameCount} (${framesPerSecond}/s) — ${framesPerSecond === 0 ? 'idle' : 'rendering'}`
  }, 500)

  return {
    div,
    graph,
    destroy: (): void => {
      window.clearInterval(intervalId)
      window.requestAnimationFrame = originalRequestAnimationFrame
    },
  }
}
