import { Graph, GraphConfigInterface } from '@cosmos.gl/graph'

export type CosmosStoryProps = GraphConfigInterface & {
  pointPositions: Float32Array;
  pointColors?: Float32Array;
  pointSizes?: Float32Array;

  links?: Float32Array;
  linkColors?: Float32Array;
  linkWidths?: Float32Array;
  // linkStrength?: Float32Array;

  pointClusters?: number[];
  clusterPositions?: number[];
  clusterStrength?: Float32Array;
}

export const createCosmos = (props: CosmosStoryProps): { div: HTMLDivElement; graph: Graph; destroy?: () => void} => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const config: GraphConfigInterface = {
    backgroundColor: '#2d313a',
    pointDefaultSize: 3,
    pointDefaultColor: '#4B5BBF',
    pointGreyoutOpacity: 0.1,
    scalePointsOnZoom: true,
    linkDefaultWidth: 0.8,
    linkDefaultColor: '#5F74C2',
    linkDefaultArrows: false,
    linkGreyoutOpacity: 0,
    curvedLinks: true,
    renderLinks: true,
    renderHoveredPointRing: true,
    fitViewOnInit: false,
    hoveredPointRingColor: '#4B5BBF',
    enableDrag: true,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationRepulsion: 0.5,
    simulationGravity: 0.02,
    simulationFriction: 0.7,
    simulationDecay: 10000000,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
    ...props,
  }

  const graph = new Graph(div, config)

  graph.setPointPositions(props.pointPositions)
  if (props.pointColors) graph.setPointColors(props.pointColors)
  if (props.pointSizes) graph.setPointSizes(props.pointSizes)

  if (props.links) graph.setLinks(props.links)
  if (props.linkColors) graph.setLinkColors(props.linkColors)
  if (props.linkWidths) graph.setLinkWidths(props.linkWidths)
  // if (props.linkStrength) graph.setLinkStrength(props.linkStrength)

  if (props.pointClusters) graph.setPointClusters(props.pointClusters)
  if (props.clusterPositions) graph.setClusterPositions(props.clusterPositions)
  if (props.clusterStrength) graph.setPointClusterStrength(props.clusterStrength)

  graph.zoom(0.9)
  graph.render()

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
