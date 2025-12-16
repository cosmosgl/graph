import { Graph, GraphConfigInterface } from '@cosmos.gl/graph'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

export const quickStart = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const config: GraphConfigInterface = {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    pointDefaultColor: '#F069B4',
    scalePointsOnZoom: true,
    simulationFriction: 0.1, // keeps the graph inert
    simulationGravity: 0, // disables gravity
    simulationRepulsion: 0.5, // increases repulsion between points
    curvedLinks: true, // curved links
    fitViewDelay: 1000, // wait 1 second before fitting the view
    fitViewPadding: 0.3, // centers the graph width padding of ~30% of screen
    rescalePositions: true, // rescale positions
    enableDrag: true, // enable dragging points
    onPointClick: pointIndex => { console.log('Clicked point index: ', pointIndex) },
    onBackgroundClick: () => { console.log('Clicked background') },
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  /* ... */
  }

  // Create luma.gl device with its own canvas
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {
      container: div,
      useDevicePixels: true,
      autoResize: true,
      width: undefined,
      height: undefined,
    },
  })

  const graph = new Graph(div, device, config)

  // Points: [x1, y1, x2, y2, x3, y3]
  const pointPositions = new Float32Array([
    0.0, 0.0, // Point 1 at (0,0)
    1.0, 0.0, // Point 2 at (1,0)
    0.5, 1.0, // Point 3 at (0.5,1)
  ])

  graph.setPointPositions(pointPositions)

  // Links: [sourceIndex1, targetIndex1, sourceIndex2, targetIndex2]
  const links = new Float32Array([
    0, 1, // Link from point 0 to point 1
    1, 2, // Link from point 1 to point 2
    2, 0, // Link from point 2 to point 0
  ])

  graph.setLinks(links)

  graph.render()

  const destroy = (): void => {
    graph.destroy()
    device.destroy()
  }

  return { div, graph, destroy }
}
