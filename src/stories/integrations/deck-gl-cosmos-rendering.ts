import { Deck, Layer, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { Graph, defaultConfigValues } from '@cosmos.gl/graph'

import { generateMeshData } from '../generate-mesh-data'

/**
 * Full cosmos.gl rendering inside a deck.gl layer.
 *
 * Where the zero-copy story re-implements minimal point/link shaders on top of
 * `getPointPositionTexture()`, this story reuses cosmos.gl's own draw programs —
 * per-point colors and sizes, per-link colors and widths, curved links, the whole
 * pipeline — via two APIs:
 *
 * - `graph.setViewTransform({k, x, y}, screenSize)` — each frame the layer
 *   translates deck.gl's viewport into cosmos.gl's view convention, so cosmos.gl
 *   projects with deck.gl's camera;
 * - `graph.drawToRenderPass(renderPass)` — cosmos.gl records its draws into
 *   deck.gl's render pass without clearing or submitting it.
 *
 * The view must use `flipY: false`: cosmos.gl's space y axis points up, and the
 * d3-zoom transform convention (uniform positive scale) cannot express deck.gl's
 * default y-down orientation.
 */
class CosmosRenderLayer extends Layer<Required<{ id: string; graph: Graph; spaceSize: number }>> {
  public static layerName = 'CosmosRenderLayer'

  public initializeState (): void {
    // All GPU state lives in the cosmos.gl instance passed via props
  }

  public draw (): void {
    const { graph, spaceSize } = this.props
    const { viewport } = this.context

    // Derive cosmos.gl's {k, x, y} from wherever deck projects world space:
    // one projected point anchors the translation, a second one measures the
    // scale. See setViewTransform's docs for the space → screen formula being
    // inverted here.
    const origin = viewport.project([0, 0]) as [number, number]
    const k = (viewport.project([1, 0]) as [number, number])[0] - origin[0]
    graph.setViewTransform({
      k,
      x: origin[0] - (k * (viewport.width - spaceSize)) / 2,
      y: origin[1] - k * (spaceSize + (viewport.height - spaceSize) / 2),
    }, [viewport.width, viewport.height])

    // No GL state babysitting needed: cosmos.gl's draw models declare their
    // full pipeline state (blend and depth) per draw, so they compose into
    // deck's pass regardless of what previous layers left behind
    graph.drawToRenderPass(this.context.renderPass)
  }
}

export const deckGlCosmosRendering = async (): Promise<{ div: HTMLDivElement; graph: Graph; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const data = generateMeshData(100, 100, 25, 1.0)
  const spaceSize = defaultConfigValues.spaceSize

  let deck!: Deck<OrthographicView>
  const devicePromise = new Promise<Device>((resolve) => {
    deck = new Deck({
      parent: div,
      // flipY: false — see CosmosRenderLayer's doc comment
      views: new OrthographicView({ flipY: false }),
      initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2.4, minZoom: -5, maxZoom: 2 },
      controller: true,
      _animate: true,
      onDeviceInitialized: resolve,
      layers: [],
    })
  })

  const graph = new Graph(null, {
    spaceSize,
    // Culling rasterizes against the screen grid cosmos would own; with deck
    // owning the viewport it only costs — the host clips off-screen points anyway
    pointOcclusionCulling: false,
    curvedLinks: true,
    simulationGravity: 0.15,
    simulationRepulsion: 0.5,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationFriction: 0.7,
    simulationDecay: 5000,
    onSimulationEnd: () => deck.setProps({ _animate: false }),
  }, devicePromise)

  graph.setPointPositions(data.pointPositions)
  // Full cosmos rendering is the point of this story — feed every visual channel
  graph.setPointColors(data.pointColors)
  graph.setPointSizes(data.pointSizes)
  graph.setLinks(data.links)
  graph.setLinkColors(data.linkColors)
  graph.setLinkWidths(data.linkWidths)
  graph.render()
  await graph.ready

  deck.setProps({
    onBeforeRender: () => {
      if (graph.isSimulationRunning) graph.step()
    },
    layers: [
      new CosmosRenderLayer({ id: 'cosmos-graph', graph, spaceSize }),
    ],
  })

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart simulation'
  restartButton.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 1; padding: 6px 12px; cursor: pointer;'
  restartButton.addEventListener('click', () => {
    graph.start()
    deck.setProps({ _animate: true })
  })
  div.appendChild(restartButton)

  return {
    div,
    graph,
    destroy: (): void => {
      // The device belongs to deck.gl: tear the graph down first (it skips
      // destroying the external device), then let deck.finalize() destroy it.
      graph.destroy()
      deck.finalize()
    },
  }
}
