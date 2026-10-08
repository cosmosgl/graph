import { Deck, OrthographicView } from '@deck.gl/core'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { TextLayer } from '@deck.gl/layers'
import { defaultConfigValues } from '@cosmos.gl/graph'
import type { Graph } from '@cosmos.gl/graph'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'
import type { CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

import './style.css'

type StoryPoint = { id: string; group: number }
type StoryLink = { source: string; target: string }
type HubLabel = { name: string; position: [number, number] }

const HUB_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta']
const SCHEMES: [number, number, number, number][][] = [
  [[88, 143, 219, 235], [219, 138, 88, 235], [126, 197, 122, 235], [190, 120, 200, 235], [219, 197, 88, 235]],
  [[64, 199, 208, 235], [235, 108, 145, 235], [156, 156, 255, 235], [255, 170, 90, 235], [140, 220, 160, 235]],
]

/**
 * `CosmosGraphLayer` the deck.gl way: the layer owns the graph, the
 * application talks to deck.gl. Clusters of `{ id, group }` records, links by
 * id, accessors for color and size, labels on the hubs from a stock
 * `TextLayer`, hover reporting the picked record, drag-to-pin. The actions
 * pause and reheat through the `Graph` handle, add
 * and remove clusters (a data change keeps the surviving layout through
 * `getPointPosition`), and recolor through `updateTriggers`.
 */
export const graphLayer = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const spaceSize = defaultConfigValues.spaceSize

  const hover = document.createElement('div')
  hover.className = 'hover'
  hover.textContent = 'hover to see the picked object'
  div.appendChild(hover)
  const status = document.createElement('div')
  status.className = 'status'
  div.appendChild(status)

  // Object data: clusters of a hub and its spokes, hubs linked in a chain
  let points: StoryPoint[] = []
  let links: StoryLink[] = []
  let clusterCount = 0
  let schemeIndex = 0
  let graph: Graph | undefined
  // The hubs are tracked for their labels: a point's index is its place in `points`
  const hubIndices = (): number[] => points.flatMap((point, index) => (point.id.startsWith('hub') ? [index] : []))
  const lastPositions = new Map<string, [number, number]>()
  const snapshotPositions = (): void => {
    if (!graph) return
    const positions = graph.getPointPositionsArray()
    points.forEach((point, index) => {
      lastPositions.set(point.id, [positions[index * 2] as number, positions[index * 2 + 1] as number])
    })
  }
  const addCluster = (): void => {
    snapshotPositions()
    const group = clusterCount
    clusterCount += 1
    const hub = `hub-${group}`
    const added: StoryPoint[] = [{ id: hub, group }]
    const addedLinks: StoryLink[] = []
    for (let spoke = 0; spoke < 14; spoke += 1) {
      const id = `p-${group}-${spoke}`
      added.push({ id, group })
      addedLinks.push({ source: hub, target: id })
    }
    if (group > 0) addedLinks.push({ source: `hub-${group - 1}`, target: hub })
    points = [...points, ...added]
    links = [...links, ...addedLinks]
  }
  const removeCluster = (): void => {
    if (clusterCount === 0) return
    snapshotPositions()
    clusterCount -= 1
    points = points.filter((point) => point.group !== clusterCount)
    // Keep only links between surviving points: the chain link into the
    // removed cluster has a surviving source and must go too
    const survivingIds = new Set(points.map((point) => point.id))
    links = links.filter((link) => survivingIds.has(link.source) && survivingIds.has(link.target))
  }

  const deck = new Deck({
    parent: div,
    views: new OrthographicView({ flipY: false }), // cosmos's space has y up
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: 1, minZoom: -5, maxZoom: 2 },
    controller: true,
    pickingRadius: 5,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [],
  })

  const graphLayer = (): Layer =>
    new CosmosGraphLayer<StoryPoint, StoryLink>({
      id: 'graph',
      points,
      links,
      getPointId: (p): string => p.id,
      // Surviving points keep their place across data changes; new ones seed randomly
      getPointPosition: (p): [number, number] | undefined => lastPositions.get(p.id),
      getPointColor: (p): [number, number, number, number] =>
        (SCHEMES[schemeIndex] as [number, number, number, number][])[p.group % 5] as [number, number, number, number],
      getPointSize: (p): number => (p.id.startsWith('hub') ? 14 : 7),
      getLinkWidth: 1.5,
      updateTriggers: { getPointColor: schemeIndex },
      config: {
        spaceSize,
        linkDefaultColor: 'rgba(94, 115, 194, 0.25)',
        simulationGravity: 0.3,
        simulationRepulsion: 1.5,
        simulationLinkDistance: 8,
        simulationLinkSpring: 1,
        simulationFriction: 0.85,
        simulationDecay: 2000,
        onSimulationTick: refreshLabels,
        onSimulationPause: refreshLabels,
        onSimulationEnd: refreshLabels,
      },
      onGraphCreated: (created): void => { graph = created },
      // The loaded points have their indices now: follow the hubs among them
      onGraphDataLoaded: ({ graph: loaded, pointsLoaded }): void => {
        if (pointsLoaded) loaded.trackPointPositionsByIndices(hubIndices())
      },
      pickable: true,
      enablePointDrag: true,
      autoHighlight: true,
      onHover: (info: PickingInfo): void => {
        const picked = info as CosmosGraphPickingInfo
        hover.textContent = picked.index >= 0
          ? `${picked.elementType}: ${JSON.stringify(picked.object)}`
          : 'hover to see the picked object'
      },
    })

  // Labels on the hubs, placed from the tracked positions
  let hubLabels: HubLabel[] = []
  const labels = (): TextLayer<HubLabel> => new TextLayer<HubLabel>({
    id: 'hub-labels',
    data: hubLabels,
    getPosition: (d): [number, number] => d.position,
    getText: (d): string => d.name,
    getSize: 16,
    getColor: [255, 255, 255, 235],
    getTextAnchor: 'start',
    getPixelOffset: [12, -12],
  })
  const layers = (): Layer[] => [graphLayer(), labels()]
  const refreshLabels = (): void => {
    if (!graph) return
    // While the simulation runs the read never waits, and the labels trail the hubs by
    // a tick. Once it rests, a plain read puts them exactly on the hubs.
    const positions = graph.getTrackedPointPositionsMap({ nonBlocking: graph.isSimulationRunning })
    hubLabels = []
    for (const [index, position] of positions) {
      const point = points[index]
      if (point) hubLabels.push({ name: HUB_NAMES[point.group % HUB_NAMES.length] as string, position })
    }
    deck.setProps({ layers: layers() })
  }

  let isPaused = false
  const setStatus = (): void => {
    const state = graph?.isSimulationRunning ? 'running' : isPaused ? 'paused' : 'settled'
    status.textContent = `${clusterCount} clusters · ${points.length} points · ${state}`
  }
  const render = (): void => {
    deck.setProps({ layers: layers() })
    setStatus()
  }
  // A data change deserves fresh energy so the new topology settles
  const reheat = (alpha: number): void => {
    graph?.start(alpha)
    isPaused = false
    pauseAction.textContent = 'Pause'
  }

  const actions = document.createElement('div')
  actions.className = 'actions'
  const actionsHeader = document.createElement('div')
  actionsHeader.className = 'actions-header'
  actionsHeader.textContent = 'Actions'
  actions.appendChild(actionsHeader)
  const makeAction = (label: string, onClick: () => void): HTMLDivElement => {
    const action = document.createElement('div')
    action.className = 'action'
    action.textContent = label
    action.addEventListener('click', onClick)
    actions.appendChild(action)
    return action
  }
  const pauseAction = makeAction('Pause', () => {
    if (!graph) return
    if (graph.isSimulationRunning) {
      graph.pause()
      isPaused = true
      pauseAction.textContent = 'Start'
    } else {
      graph.unpause()
      isPaused = false
      pauseAction.textContent = 'Pause'
    }
    setStatus()
  })
  makeAction('Reheat', () => { reheat(0.3); setStatus() })
  makeAction('Add cluster', () => { addCluster(); render(); reheat(0.5) })
  makeAction('Remove cluster', () => { removeCluster(); render(); reheat(0.5) })
  makeAction('Recolor', () => { schemeIndex = (schemeIndex + 1) % SCHEMES.length; render() })
  div.appendChild(actions)

  addCluster()
  addCluster()
  addCluster()
  render()
  // The status follows the simulation as it settles on its own
  const ticker = window.setInterval(setStatus, 500)

  return {
    div,
    destroy: (): void => {
      window.clearInterval(ticker)
      // The layer owns the graph: finalizing deck finalizes the layer, which destroys it
      deck.finalize()
    },
  }
}
