import { Deck, MapView, COORDINATE_SYSTEM } from '@deck.gl/core'
import type { Layer, LayerProps, PickingInfo } from '@deck.gl/core'
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'
import type { CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'
import type { GraphSimulation } from '@cosmos.gl/graph'

import './style.css'

type City = { name: string; lngLat: [number, number] }
// A traveller on a trip keeps flying between home and the city it visits. One headed
// home for good finishes the round trip it is on.
type Trip = { city: number; startedAt: number; period: number; endsAt: number | undefined }
type StoryPoint = {
  id: string;
  name: string;
  home: number;
  trip: Trip | undefined;
  isCity: boolean;
  // How far along its way a traveller is: 0 at home, 1 at the city it visits
  progress: number;
}
// A traveller is tied to its home, and on a trip to the city it visits
type StoryLink = { source: string; target: string; kind: 'home' | 'away'; traveller: StoryPoint }
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
// Every half second, this many travellers set off or turn for home
const TRICKLE_MS = 500
const TRICKLE_COUNT = 3
// A round trip, home to the visited city and back, takes this long
const ROUND_TRIP_MS: [number, number] = [9000, 16000]
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
 * close to home. A traveller on a trip keeps flying to another city and back: it
 * is tied to both, and the two ties trade strength as it goes, so the simulation
 * flies it along the line between them. The story sets those strengths on the
 * simulation itself, every frame, through the indices the layer reports when it
 * loads the links. A few travellers set off or turn for home every half second,
 * and the simulation never cools down, so the map never rests. Shuffle the trips
 * and everyone flies to a new place at once.
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

  // A trip to one of the cities the home city has a route to, for a share of the travellers.
  // `elapsed` is how far into its first round trip the traveller already is.
  const pickTrip = (home: number, now: number, share = 0.4, elapsed = 0): Trip | undefined => {
    if (Math.random() >= share) return undefined
    const destinations = ROUTES.flatMap(([a, b]) => (a === home ? [b] : b === home ? [a] : []))
    const city = destinations[Math.floor(Math.random() * destinations.length)]
    if (city === undefined) return undefined
    const [shortest, longest] = ROUND_TRIP_MS
    const period = shortest + Math.random() * (longest - shortest)
    return { city, startedAt: now - elapsed * period, period, endsAt: undefined }
  }
  // 0 at home, 1 at the visited city, easing in and out at both ends
  const tripProgress = (trip: Trip, now: number): number => (1 - Math.cos((2 * Math.PI * (now - trip.startedAt)) / trip.period)) / 2

  const start = performance.now()
  const points: StoryPoint[] = []
  const seeds = new Map<string, [number, number]>()
  CITIES.forEach((city, cityIndex) => {
    const [x, y] = toLayout(city.lngLat)
    points.push({ id: `city-${cityIndex}`, name: city.name, home: cityIndex, trip: undefined, isCity: true, progress: 0 })
    seeds.set(`city-${cityIndex}`, [x, y])
    for (let traveller = 0; traveller < TRAVELLERS_PER_CITY; traveller += 1) {
      const id = `traveller-${cityIndex}-${traveller}`
      const name = TRAVELLER_NAMES[Math.floor(Math.random() * TRAVELLER_NAMES.length)] as string
      points.push({ id, name, home: cityIndex, trip: pickTrip(cityIndex, start, 0.4, Math.random()), isCity: false, progress: 0 })
      seeds.set(id, [x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 80])
    }
  })
  const travellers = points.filter((point) => !point.isCity)
  const cityIndices = points.flatMap((point, index) => (point.isCity ? [index] : []))

  // Every tie is a link, and each link is a spring. The traveller is the source of both
  // of its ties, so the simulation applies their pulls in the same pass.
  const tie = (): StoryLink[] => travellers.flatMap((traveller): StoryLink[] => {
    const home: StoryLink = { source: traveller.id, target: `city-${traveller.home}`, kind: 'home', traveller }
    if (!traveller.trip) return [home]
    return [home, { source: traveller.id, target: `city-${traveller.trip.city}`, kind: 'away', traveller }]
  })
  let links = tie()

  // The strengths go to the simulation directly. They line up with the links it holds,
  // which the layer reports after each load: until a new set of links is in, the strengths
  // are for the old one, weighted by the travellers' current trips — for the frame or so
  // after a shuffle, an old away tie pulls by the new trip's progress.
  let simulation: GraphSimulation | undefined
  let loadedLinks: readonly StoryLink[] = []
  const degree = new Map<string, number>()
  // cosmos.gl splits a spring's pull between its two ends by degree — the better-connected
  // end moves less — and takes the square root of the strength. A traveller's end of each
  // tie gets only its share (the city's share moves nothing: cities are pinned); dividing
  // that out and squaring leaves each tie pulling with exactly its weight: home
  // 1 - progress, away progress. The weights add up to one, so the traveller rests that far
  // along the line from home to the city it visits.
  const sendStrengths = (): void => {
    if (!simulation || loadedLinks.length === 0) return // nothing loaded yet
    const strengths = new Float32Array(loadedLinks.length)
    loadedLinks.forEach((link, i) => {
      const { progress } = link.traveller
      const weight = link.kind === 'home' ? 1 - progress : progress
      const cityDegree = degree.get(link.target) ?? 1
      const share = cityDegree / (cityDegree + (degree.get(link.source) ?? 1))
      strengths[i] = (weight / share) ** 2
    })
    simulation.setLinkStrength(strengths)
    simulation.applyData()
  }

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
        // Stiff enough for a traveller to keep up with its moving ties
        simulationLinkSpring: 0.1,
        // Every strength update rebuilds the link force, which would draw each tie's
        // random rest length again every frame: keep them all the same
        simulationLinkDistRandomVariationRange: [1, 1],
        // The energy never fades, so the simulation follows every change without a reheat
        simulationDecay: Infinity,
      },
      // The cities stay on their places; everything else moves
      onSimulationCreated: (created): void => {
        simulation = created
        created.setPinnedPoints(cityIndices)
      },
      // A new set of links is in: the strengths follow its order from now on
      onSimulationDataLoaded: (info): void => {
        if (!info.linksLoaded || !info.links) return
        loadedLinks = info.links
        degree.clear()
        for (const { source, target } of loadedLinks) {
          degree.set(source, (degree.get(source) ?? 0) + 1)
          degree.set(target, (degree.get(target) ?? 0) + 1)
        }
        sendStrengths()
      },
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
          hover.textContent = `${point.name} · home to ${TRAVELLERS_PER_CITY} travellers · ${away} on trips · ${visiting} visiting`
        } else {
          const home = (CITIES[point.home] as City).name
          const trip = point.trip
            ? ` · ${point.trip.endsAt === undefined ? 'keeps flying to' : 'heading home from'} ${(CITIES[point.trip.city] as City).name}`
            : ''
          hover.textContent = `${point.name} · lives in ${home}${trip}`
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

  // A new links array, which the layer loads on its next update
  const render = (): void => {
    links = tie()
    deck.setProps({ layers: [countries(), graph(), labels()] })
    const away = travellers.filter((point) => point.trip).length
    status.textContent = `${CITIES.length} cities · ${travellers.length} travellers · ${away} on trips`
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
  // New trips, each somewhere along its way: everyone flies to a new place at once
  makeAction('Shuffle trips', () => {
    const now = performance.now()
    for (const point of travellers) point.trip = pickTrip(point.home, now, 0.4, Math.random())
    render()
  })
  // The trickle: a traveller on a trip turns for home, landing there at the end of the round
  // trip it is on; one at home sets off two times in three, which holds the share on trips
  // near the 40% the story starts with. Returns whether a trip started, which adds a tie.
  const trickle = (now: number): boolean => {
    let started = false
    for (let i = 0; i < TRICKLE_COUNT; i += 1) {
      const point = travellers[Math.floor(Math.random() * travellers.length)] as StoryPoint
      if (!point.trip) {
        point.trip = pickTrip(point.home, now, 2 / 3)
        started ||= point.trip !== undefined
      } else if (point.trip.endsAt === undefined) {
        const roundTrips = Math.ceil((now - point.trip.startedAt) / point.trip.period)
        point.trip.endsAt = point.trip.startedAt + roundTrips * point.trip.period
      }
    }
    return started
  }

  // Every frame moves each traveller along its trip and sends the strengths that hold it
  // there; the links change only when a trip starts or ends
  let lastTrickle = start
  let animationFrame = 0
  const tick = (now: number): void => {
    let tripsChanged = false
    if (now - lastTrickle >= TRICKLE_MS) {
      lastTrickle = now
      tripsChanged = trickle(now)
    }
    for (const traveller of travellers) {
      const trip = traveller.trip
      if (trip?.endsAt !== undefined && now >= trip.endsAt) {
        traveller.trip = undefined
        tripsChanged = true
      }
      traveller.progress = traveller.trip ? tripProgress(traveller.trip, now) : 0
    }
    if (tripsChanged) render()
    sendStrengths()
    animationFrame = requestAnimationFrame(tick)
  }
  // Above the canvas deck created: the countries are opaque
  div.append(actions, hover, status)

  render()
  animationFrame = requestAnimationFrame(tick)

  return {
    div,
    destroy: (): void => {
      cancelAnimationFrame(animationFrame)
      // The layer owns the simulation: finalizing deck finalizes the layer, which destroys it
      deck.finalize()
    },
  }
}
