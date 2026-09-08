import { Deck, OrthographicView } from '@deck.gl/core'
import { defaultConfigValues, type GraphSimulation } from '@cosmos.gl/graph'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'

type StoryPoint = {
  id: string;
  group: number;
}

type StoryLink = {
  source: string;
  target: string;
}

const SCHEMES: [number, number, number, number][][] = [
  [
    [88, 143, 219, 235],
    [219, 138, 88, 235],
    [126, 197, 122, 235],
    [190, 120, 200, 235],
    [219, 197, 88, 235],
  ],
  [
    [64, 199, 208, 235],
    [235, 108, 145, 235],
    [156, 156, 255, 235],
    [255, 170, 90, 235],
    [140, 220, 160, 235],
  ],
]

/**
 * A living graph. "Add cluster" and "Remove cluster" hand the layer new
 * points/links arrays — a data change re-ingests the graph, and the story
 * keeps the surviving layout by snapshotting positions before each change and
 * feeding them back through `getPointPosition` (new points stay undefined and
 * seed randomly). "Recolor" swaps the palette through `updateTriggers`, and
 * the color attribute's transition animates the change.
 */
export const cosmosGraphUpdates = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const spaceSize = defaultConfigValues.spaceSize

  let points: StoryPoint[] = []
  let links: StoryLink[] = []
  let groupCounter = 0
  let schemeIndex = 0
  let simulation: GraphSimulation | undefined
  const lastPositions = new Map<string, [number, number]>()

  const snapshotPositions = (): void => {
    if (!simulation) return
    const positions = simulation.getPointPositionsArray()
    points.forEach((point, index) => {
      lastPositions.set(point.id, [positions[index * 2] as number, positions[index * 2 + 1] as number])
    })
  }

  const addCluster = (): void => {
    snapshotPositions()
    const group = groupCounter
    groupCounter += 1
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
    if (groupCounter === 0) return
    snapshotPositions()
    groupCounter -= 1
    points = points.filter((point) => point.group !== groupCounter)
    // Keep only links between surviving points: the inter-hub link into the
    // removed cluster has a surviving source and must go too
    const survivingIds = new Set(points.map((point) => point.id))
    links = links.filter((link) => survivingIds.has(link.source) && survivingIds.has(link.target))
  }

  const makeLayer = (): CosmosGraphLayer<StoryPoint, StoryLink> =>
    new CosmosGraphLayer<StoryPoint, StoryLink>({
      id: 'cosmos-updates',
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
      transitions: { getPointColor: 600 },
      simulationConfig: {
        spaceSize,
        simulationGravity: 0.3,
        simulationRepulsion: 1.5,
        simulationLinkDistance: 8,
        simulationLinkSpring: 1,
        simulationFriction: 0.85,
        simulationDecay: 2000,
      },
      onSimulationCreated: (sim): void => { simulation = sim },
      pickable: true,
      enablePointDrag: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 220],
    })

  addCluster()
  addCluster()
  addCluster()

  const deck = new Deck({
    parent: div,
    views: new OrthographicView(),
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2, minZoom: -5, maxZoom: 2 },
    controller: true,
    pickingRadius: 5,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [makeLayer()],
  })

  const update = (): void => {
    deck.setProps({ layers: [makeLayer()] })
    // A data change deserves fresh energy so the new topology settles
    simulation?.start(0.5)
  }

  const buttonStyle = 'padding: 6px 12px; cursor: pointer;'
  const controls = document.createElement('div')
  controls.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 1; display: flex; gap: 8px;'
  const makeButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText = buttonStyle
    button.addEventListener('click', onClick)
    controls.appendChild(button)
  }
  makeButton('Add cluster', () => { addCluster(); update() })
  makeButton('Remove cluster', () => { removeCluster(); update() })
  makeButton('Recolor', () => {
    schemeIndex = (schemeIndex + 1) % SCHEMES.length
    deck.setProps({ layers: [makeLayer()] })
  })
  div.appendChild(controls)

  return {
    div,
    destroy: (): void => deck.finalize(),
  }
}
