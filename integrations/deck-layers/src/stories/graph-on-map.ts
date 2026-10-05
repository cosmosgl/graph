import { Deck, MapView, COORDINATE_SYSTEM } from '@deck.gl/core'
import type { Layer, LayerProps, PickingInfo } from '@deck.gl/core'
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'
import type { CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

import './style.css'

type City = { name: string; lngLat: [number, number] }
// A city, or a traveller with a home city and, for some, a trip: the city it keeps visiting,
// and how many ties hold it to home and to that city
type Trip = { city: number; homeTies: number; awayTies: number }
type StoryPoint = { id: string; name: string; home: number; trip: Trip | undefined; isCity: boolean }
type StoryLink = { source: string; target: string }
type CityLabel = { name: string; position: [number, number] }

const COUNTRIES = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson'
const CITIES: City[] = [
  { name: 'San Francisco', lngLat: [-122.42, 37.77] },
  { name: 'Mexico City', lngLat: [-99.13, 19.43] },
  { name: 'New York', lngLat: [-74.01, 40.71] },
  { name: 'São Paulo', lngLat: [-46.63, -23.55] },
  { name: 'London', lngLat: [-0.13, 51.51] },
  { name: 'Lagos', lngLat: [3.38, 6.52] },
  { name: 'Cairo', lngLat: [31.24, 30.04] },
  { name: 'Johannesburg', lngLat: [28.05, -26.2] },
  { name: 'Dubai', lngLat: [55.27, 25.2] },
  { name: 'Mumbai', lngLat: [72.88, 19.08] },
  { name: 'Singapore', lngLat: [103.82, 1.35] },
  { name: 'Tokyo', lngLat: [139.69, 35.69] },
  { name: 'Sydney', lngLat: [151.21, -33.87] },
]
// Routes between cities, by index into CITIES: a traveller visits along one of these
const ROUTES: [number, number][] = [
  [0, 2], [0, 1], [1, 3], [2, 4], [2, 3], [4, 5], [4, 6], [5, 7], [6, 8], [8, 9], [9, 10], [10, 11], [10, 12], [4, 8],
]
const TRAVELLER_NAMES = ['Milo', 'Zuri', 'Kai', 'Nova', 'Iris', 'Odin', 'Luna', 'Remy', 'Suki', 'Theo', 'Yara', 'Enzo', 'Cleo', 'Finn', 'Mira', 'Jude']
const TRAVELLERS_PER_CITY = 45
// Every half second, this many travellers set off or come home
const TRICKLE_MS = 500
const TRICKLE_COUNT = 3
const PALETTE: [number, number, number][] = [
  [88, 143, 219], [219, 138, 88], [126, 197, 122], [190, 120, 200], [219, 197, 88], [64, 199, 208], [235, 108, 145],
]

// The layout space is the map. deck.gl's map views place the whole world on a 512-unit
// square (Web Mercator); the simulation works on the same square at its own size, and one
// model matrix scales between the two.
const SPACE = 4096
const MODEL_MATRIX: NonNullable<LayerProps['modelMatrix']> = [512 / SPACE, 0, 0, 0, 0, 512 / SPACE, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const toLayout = ([lng, lat]: [number, number]): [number, number] => [
  ((lng + 180) / 360) * SPACE,
  ((Math.PI + Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / (2 * Math.PI)) * SPACE,
]

/**
 * A graph on a map. deck.gl draws the countries and owns the camera; cosmos.gl lays
 * the graph out in the map's own space. Every city is a point pinned at its real
 * place, and every other point is a traveller tied to its home city. Most stay
 * close to home. A traveller who keeps visiting another city is tied to both, and
 * hangs between them, nearer the one with more ties, so every route fills with the
 * people who share it. A few travellers set off or come home every half second, and
 * the simulation never cools down, so the map never rests. Shuffle the trips and
 * everyone flies to a new place at once.
 */
export const graphOnMap = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const hover = document.createElement('div')
  hover.className = 'hover'
  hover.textContent = 'hover to see the picked object'
  const status = document.createElement('div')
  status.className = 'status'

  // A trip to one of the cities the home city has a route to, for a share of the travellers
  const pickTrip = (home: number, share = 0.4): Trip | undefined => {
    if (Math.random() >= share) return undefined
    const destinations = ROUTES.flatMap(([a, b]) => (a === home ? [b] : b === home ? [a] : []))
    const city = destinations[Math.floor(Math.random() * destinations.length)]
    const ties = (): number => 1 + Math.floor(Math.random() * 4)
    return city === undefined ? undefined : { city, homeTies: ties(), awayTies: ties() }
  }

  const points: StoryPoint[] = []
  const seeds = new Map<string, [number, number]>()
  CITIES.forEach((city, cityIndex) => {
    const [x, y] = toLayout(city.lngLat)
    points.push({ id: `city-${cityIndex}`, name: city.name, home: cityIndex, trip: undefined, isCity: true })
    seeds.set(`city-${cityIndex}`, [x, y])
    for (let traveller = 0; traveller < TRAVELLERS_PER_CITY; traveller += 1) {
      const id = `traveller-${cityIndex}-${traveller}`
      const name = TRAVELLER_NAMES[Math.floor(Math.random() * TRAVELLER_NAMES.length)] as string
      points.push({ id, name, home: cityIndex, trip: pickTrip(cityIndex), isCity: false })
      seeds.set(id, [x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 80])
    }
  })
  // A traveller is tied to its home, and to the city it visits. Every tie is a link, and
  // each link is a spring: more ties to a city bring the traveller closer to it.
  const tie = (): StoryLink[] => points.flatMap((point) => {
    if (point.isCity) return []
    const home = { source: point.id, target: `city-${point.home}` }
    if (!point.trip) return [home]
    const away = { source: point.id, target: `city-${point.trip.city}` }
    return [...Array<StoryLink>(point.trip.homeTies).fill(home), ...Array<StoryLink>(point.trip.awayTies).fill(away)]
  })
  let links = tie()
  const travellers = points.filter((point) => !point.isCity)

  const cityIndices = points.flatMap((point, index) => (point.isCity ? [index] : []))

  const deck = new Deck({
    parent: div,
    views: new MapView({ repeat: false }),
    initialViewState: { longitude: 20, latitude: 22, zoom: 1.4, minZoom: 0.5, maxZoom: 8 },
    controller: true,
    pickingRadius: 5,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [],
  })

  const countries = (): Layer => new GeoJsonLayer({
    id: 'countries',
    data: COUNTRIES,
    filled: true,
    getFillColor: [38, 48, 72],
    stroked: true,
    getLineColor: [70, 86, 120],
    lineWidthMinPixels: 0.5,
  })

  const graph = (): Layer =>
    new CosmosGraphLayer<StoryPoint, StoryLink>({
      id: 'graph',
      points,
      links,
      getPointId: (p): string => p.id,
      getPointPosition: (p): [number, number] | undefined => seeds.get(p.id),
      getPointColor: (p): [number, number, number, number] => [...(PALETTE[p.home % PALETTE.length] as [number, number, number]), 235],
      getPointSize: (p): number => (p.isCity ? 11 : 4.5),
      getLinkColor: [150, 170, 220, 45],
      // The graph lives in the map's space
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      modelMatrix: MODEL_MATRIX,
      simulationConfig: {
        spaceSize: SPACE,
        // Nothing pulls the graph to the centre of the space: the cities hold it
        simulationGravity: 0,
        simulationCenter: 0,
        simulationRepulsion: 0.4,
        simulationLinkDistance: 30,
        // Soft springs, so a flight between cities takes a few seconds and can be watched.
        // The ties add up: at the default spring a traveller with six or more ties would
        // overshoot its place every frame and fly off
        simulationLinkSpring: 0.01,
        // The energy never fades, so the simulation follows every change without a reheat
        simulationDecay: Infinity,
      },
      // The cities stay on their places; everything else moves
      onSimulationCreated: (simulation): void => { simulation.setPinnedPoints(cityIndices) },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 220],
      onHover: (info: PickingInfo): void => {
        const picked = info as CosmosGraphPickingInfo
        // Leaving a point or a link reports it once more, with no object: only a point names itself
        const point = picked.elementType === 'point' ? picked.object as StoryPoint | undefined : undefined
        if (!point) {
          hover.textContent = 'hover to see the picked object'
        } else if (point.isCity) {
          // Counted at hover time: deck reports a hover only when the pointer moves
          const away = travellers.filter((t) => t.home === point.home && t.trip).length
          const visiting = travellers.filter((t) => t.trip?.city === point.home).length
          hover.textContent = `${point.name} · home to ${TRAVELLERS_PER_CITY} travellers · ${away} away · ${visiting} visiting`
        } else {
          const home = (CITIES[point.home] as City).name
          const visits = point.trip ? ` · keeps visiting ${(CITIES[point.trip.city] as City).name}` : ''
          hover.textContent = `${point.name} · lives in ${home}${visits}`
        }
      },
    })

  // The cities are pinned, so their names sit at fixed places
  const cityLabels: CityLabel[] = CITIES.map((city) => ({ name: city.name, position: toLayout(city.lngLat) }))
  const labels = (): Layer => new TextLayer<CityLabel>({
    id: 'city-labels',
    data: cityLabels,
    getPosition: (d): [number, number] => d.position,
    getText: (d): string => d.name,
    getSize: 13,
    getColor: [255, 255, 255, 235],
    getTextAnchor: 'start',
    getPixelOffset: [10, -10],
    characterSet: 'auto',
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    modelMatrix: MODEL_MATRIX,
  })

  const setStatus = (): void => {
    const away = points.filter((point) => point.trip).length
    status.textContent = `${CITIES.length} cities · ${points.length - CITIES.length} travellers · ${away} between cities`
  }
  const render = (): void => {
    deck.setProps({ layers: [countries(), graph(), labels()] })
    setStatus()
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
  // New links over the same points: the layout carries on, and the travellers fly to their new places
  makeAction('Shuffle trips', () => {
    for (const point of travellers) point.trip = pickTrip(point.home)
    links = tie()
    render()
  })
  // The trickle: a traveller on a trip comes home; one at home sets off two times in three,
  // which holds the share on trips near the 40% the story starts with
  const trickle = (): void => {
    for (let i = 0; i < TRICKLE_COUNT; i += 1) {
      const point = travellers[Math.floor(Math.random() * travellers.length)] as StoryPoint
      point.trip = point.trip ? undefined : pickTrip(point.home, 2 / 3)
    }
    links = tie()
    render()
  }
  const timer = window.setInterval(trickle, TRICKLE_MS)
  // Above the canvas deck created: the countries are opaque
  div.append(actions, hover, status)

  render()

  return {
    div,
    destroy: (): void => {
      window.clearInterval(timer)
      // The layer owns the simulation: finalizing deck finalizes the layer, which destroys it
      deck.finalize()
    },
  }
}
