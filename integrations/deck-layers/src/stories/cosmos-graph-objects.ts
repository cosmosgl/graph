import { Deck, OrthographicView, type PickingInfo } from '@deck.gl/core'
import { defaultConfigValues } from '@cosmos.gl/graph'
import { CosmosGraphLayer, type CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

type StoryPoint = {
  id: string;
  group: number;
}

type StoryLink = {
  source: string;
  target: string;
}

const GROUP_COLORS: [number, number, number, number][] = [
  [88, 143, 219, 235],
  [219, 138, 88, 235],
  [126, 197, 122, 235],
]

/**
 * `CosmosGraphLayer` with plain objects and accessors — the deck-idiomatic
 * on-ramp. Points are `{ id, group }` records, links reference point ids, and
 * accessors carry color and size; the layer builds the id→index mapping,
 * seeds positions randomly, and picking hands back the original objects.
 */
export const cosmosGraphObjects = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const spaceSize = defaultConfigValues.spaceSize

  // Three hubs with spokes, plus a loose ring between the hubs
  const points: StoryPoint[] = []
  const links: StoryLink[] = []
  for (let group = 0; group < 3; group += 1) {
    const hub = `hub-${group}`
    points.push({ id: hub, group })
    for (let spoke = 0; spoke < 16; spoke += 1) {
      const id = `p-${group}-${spoke}`
      points.push({ id, group })
      links.push({ source: hub, target: id })
    }
  }
  links.push({ source: 'hub-0', target: 'hub-1' })
  links.push({ source: 'hub-1', target: 'hub-2' })
  links.push({ source: 'hub-2', target: 'hub-0' })

  const hoverStatus = document.createElement('div')
  hoverStatus.textContent = 'hover to see the picked object'
  hoverStatus.style.cssText =
    'position: absolute; top: 12px; right: 12px; z-index: 1; padding: 6px 12px; ' +
    'font: 12px monospace; color: #fff; background: rgba(0, 0, 0, 0.5); border-radius: 4px;'
  div.appendChild(hoverStatus)

  const deck = new Deck({
    parent: div,
    views: new OrthographicView(),
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2, minZoom: -5, maxZoom: 2 },
    controller: true,
    pickingRadius: 5,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [
      new CosmosGraphLayer<StoryPoint, StoryLink>({
        id: 'cosmos-graph-objects',
        points,
        links,
        getPointId: (p): string => p.id,
        getPointColor: (p): [number, number, number, number] => GROUP_COLORS[p.group] as [number, number, number, number],
        getPointSize: (p): number => (p.id.startsWith('hub') ? 14 : 7),
        getLinkWidth: 1.5,
        simulationConfig: {
          spaceSize,
          simulationGravity: 0.25,
          simulationRepulsion: 1.5,
          simulationLinkDistance: 8,
          simulationLinkSpring: 1,
          simulationFriction: 0.85,
          simulationDecay: 2000,
        },
        pickable: true,
        enablePointDrag: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 220],
        onHover: (info: PickingInfo): void => {
          const picked = info as CosmosGraphPickingInfo
          hoverStatus.textContent = picked.index >= 0
            ? `${picked.elementType}: ${JSON.stringify(picked.object)}`
            : 'hover to see the picked object'
        },
      }),
    ],
  })

  return {
    div,
    // The layer owns the simulation: deck.finalize() finalizes the layer,
    // which destroys it
    destroy: (): void => deck.finalize(),
  }
}
