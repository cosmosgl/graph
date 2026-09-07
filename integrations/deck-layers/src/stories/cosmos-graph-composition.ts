import { Deck, OrthographicView } from '@deck.gl/core'
import { TextLayer } from '@deck.gl/layers'
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

type HubLabel = {
  name: string;
  position: [number, number];
}

const GROUPS = 4
const SPOKES = 18
const HUB_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta']
const GROUP_COLORS: [number, number, number, number][] = [
  [88, 143, 219, 235],
  [219, 138, 88, 235],
  [126, 197, 122, 235],
  [190, 120, 200, 235],
]

/**
 * A first-class deck citizen: the cosmos graph interleaved with a stock
 * `TextLayer` in one `Deck`, on one device. The hub labels track the moving
 * simulation through a tiny position snapshot per tick — fine at this scale;
 * a large graph would throttle and use the async snapshot instead. Picking,
 * highlight and drag keep working underneath the labels.
 */
export const cosmosGraphComposition = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const spaceSize = defaultConfigValues.spaceSize

  const points: StoryPoint[] = []
  const links: StoryLink[] = []
  for (let group = 0; group < GROUPS; group += 1) {
    const hub = `hub-${group}`
    points.push({ id: hub, group })
    for (let spoke = 0; spoke < SPOKES; spoke += 1) {
      const id = `p-${group}-${spoke}`
      points.push({ id, group })
      links.push({ source: hub, target: id })
    }
    links.push({ source: hub, target: `hub-${(group + 1) % GROUPS}` })
  }
  // Hubs sit first in each group: dense index = group * (SPOKES + 1)
  const hubIndices = HUB_NAMES.map((name, group) => group * (SPOKES + 1))

  let simulation: GraphSimulation | undefined
  let hubLabels: HubLabel[] = []

  function refreshLabels (): void {
    if (!simulation) return
    // 76 points — a sync snapshot is trivial here
    const positions = simulation.getPointPositionsArray()
    hubLabels = hubIndices.map((pointIndex, group) => ({
      name: HUB_NAMES[group] as string,
      position: [positions[pointIndex * 2] as number, positions[pointIndex * 2 + 1] as number],
    }))
    deck.setProps({ layers: [graphLayer(), labelLayer()] })
  }

  const graphLayer = (): CosmosGraphLayer<StoryPoint, StoryLink> =>
    new CosmosGraphLayer<StoryPoint, StoryLink>({
      id: 'cosmos-graph',
      points,
      links,
      getPointId: (p): string => p.id,
      getPointColor: (p): [number, number, number, number] => GROUP_COLORS[p.group] as [number, number, number, number],
      getPointSize: (p): number => (p.id.startsWith('hub') ? 16 : 7),
      getLinkWidth: 1.5,
      simulationConfig: {
        spaceSize,
        simulationGravity: 0.25,
        simulationRepulsion: 1.5,
        simulationLinkDistance: 8,
        simulationLinkSpring: 1,
        simulationFriction: 0.85,
        simulationDecay: 2000,
        onSimulationTick: refreshLabels,
      },
      onSimulationCreated: (sim): void => { simulation = sim },
      pickable: true,
      enablePointDrag: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 220],
    })

  const labelLayer = (): TextLayer<HubLabel> =>
    new TextLayer<HubLabel>({
      id: 'hub-labels',
      data: hubLabels,
      getPosition: (d): [number, number] => d.position,
      getText: (d): string => d.name,
      getSize: 16,
      getColor: [255, 255, 255, 235],
      getTextAnchor: 'start',
      getPixelOffset: [12, -12],
    })

  const deck = new Deck({
    parent: div,
    views: new OrthographicView(),
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2, minZoom: -5, maxZoom: 2 },
    controller: true,
    pickingRadius: 5,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [graphLayer(), labelLayer()],
  })

  return {
    div,
    destroy: (): void => deck.finalize(),
  }
}
