import { Deck, MapView } from '@deck.gl/core'
import type { Layer, LayerProps } from '@deck.gl/core'
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'
import { PointShape } from '@cosmos.gl/graph'
import type { Graph } from '@cosmos.gl/graph'

import './style.css'

type City = { name: string; lngLat: [number, number] }
// A traveller on a trip keeps flying between home and the city it visits, along the route
// between them. One headed home for good finishes the round trip it is on.
type Trip = { city: number; route: number; startedAt: number; period: number; endsAt: number | undefined }
type StoryPoint = {
  id: string;
  name: string;
  kind: 'city' | 'waypoint' | 'traveller';
  home: number;
  trip: Trip | undefined;
  // How far along its route a traveller is: 0 at home, 1 at the city it visits
  progress: number;
}
// A route is drawn between two cities. A tie is a spring from a traveller to one of the
// three points its route's curve is made of: home, the route's waypoint, the city it visits.
type StoryLink =
  | { source: string; target: string; kind: 'route' }
  | { source: string; target: string; kind: 'home' | 'waypoint' | 'away'; traveller: StoryPoint }
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

// The layer draws a curved link as a rational quadratic Bézier: its point at t is the
// average of the source, a control point and the target, weighted (1-t)², 2t(1-t)·w and t².
// A traveller held by three springs with those weights rests on that very curve.
const CURVE_WEIGHT = 0.8
const CURVE_CONTROL_DISTANCE = 0.3
// Where the layer puts a route's control point: on the chord's normal, a share of the
// chord's length from its middle
const routeWaypoint = ([from, to]: [number, number]): [number, number] => {
  const [ax, ay] = toLayout((CITIES[from] as City).lngLat)
  const [bx, by] = toLayout((CITIES[to] as City).lngLat)
  return [(ax + bx) / 2 - (by - ay) * CURVE_CONTROL_DISTANCE, (ay + by) / 2 + (bx - ax) * CURVE_CONTROL_DISTANCE]
}
// Normalised, so a traveller is pulled as hard at every point of its way
const curveWeights = (t: number): Record<'home' | 'waypoint' | 'away', number> => {
  const home = (1 - t) ** 2
  const waypoint = 2 * t * (1 - t) * CURVE_WEIGHT
  const away = t ** 2
  const sum = home + waypoint + away
  return { home: home / sum, waypoint: waypoint / sum, away: away / sum }
}

/**
 * A graph on a map. deck.gl draws the countries and owns the camera; cosmos.gl lays
 * the graph out in the map's own space and draws it with its own renderer — the
 * cities are stars, hexagons and squares, the routes are curves with arrows. Every
 * city is a point pinned at its real place, joined to its neighbours by routes, and
 * every other point is a traveller tied to its home city. Most stay close to home.
 * A traveller on a trip keeps flying to another city and back: its ties to home, to
 * the route's curve and to the city it visits trade strength as it goes, and those
 * strengths trace the curve, so the simulation flies it along the arc. The story
 * sets them on the graph itself, every frame, through the indices the layer
 * reports when it loads the links. A few travellers set off or turn for home every
 * half second, and the simulation never cools down, so the map never rests.
 * Shuffle the trips and everyone flies to a new place at once.
 */
export const graphOnMap = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const status = document.createElement('div')
  status.className = 'status'

  // A trip to one of the cities the home city has a route to, for a share of the travellers.
  // `elapsed` is how far into its first round trip the traveller already is.
  const pickTrip = (home: number, now: number, share = 0.4, elapsed = 0): Trip | undefined => {
    if (Math.random() >= share) return undefined
    const routes = ROUTES.flatMap(([a, b], route) => (a === home ? [{ city: b, route }] : b === home ? [{ city: a, route }] : []))
    const picked = routes[Math.floor(Math.random() * routes.length)]
    if (!picked) return undefined
    const [shortest, longest] = ROUND_TRIP_MS
    const period = shortest + Math.random() * (longest - shortest)
    return { ...picked, startedAt: now - elapsed * period, period, endsAt: undefined }
  }
  // 0 at home, 1 at the visited city, easing in and out at both ends
  const tripProgress = (trip: Trip, now: number): number => (1 - Math.cos((2 * Math.PI * (now - trip.startedAt)) / trip.period)) / 2

  const start = performance.now()
  const points: StoryPoint[] = []
  const seeds = new Map<string, [number, number]>()
  CITIES.forEach((city, cityIndex) => {
    points.push({ id: `city-${cityIndex}`, name: city.name, kind: 'city', home: cityIndex, trip: undefined, progress: 0 })
    seeds.set(`city-${cityIndex}`, toLayout(city.lngLat))
  })
  // A route's waypoint is the control point of its curve: an invisible pinned point
  ROUTES.forEach((route, routeIndex) => {
    points.push({ id: `waypoint-${routeIndex}`, name: '', kind: 'waypoint', home: route[0], trip: undefined, progress: 0 })
    seeds.set(`waypoint-${routeIndex}`, routeWaypoint(route))
  })
  CITIES.forEach((city, cityIndex) => {
    const [x, y] = toLayout(city.lngLat)
    for (let traveller = 0; traveller < TRAVELLERS_PER_CITY; traveller += 1) {
      const id = `traveller-${cityIndex}-${traveller}`
      const name = TRAVELLER_NAMES[Math.floor(Math.random() * TRAVELLER_NAMES.length)] as string
      points.push({ id, name, kind: 'traveller', home: cityIndex, trip: pickTrip(cityIndex, start, 0.4, Math.random()), progress: 0 })
      seeds.set(id, [x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 80])
    }
  })
  const travellers = points.filter((point) => point.kind === 'traveller')
  const pinnedIndices = points.flatMap((point, index) => (point.kind === 'traveller' ? [] : [index]))

  // The routes, and every traveller's ties: to home always, and on a trip to its route's
  // waypoint and the city it visits. Each tie is a spring, with the traveller as its
  // source, so the simulation applies all three pulls in the same pass.
  const tie = (): StoryLink[] => [
    ...ROUTES.map(([a, b]): StoryLink => ({ source: `city-${a}`, target: `city-${b}`, kind: 'route' })),
    ...travellers.flatMap((traveller): StoryLink[] => {
      const home: StoryLink = { source: traveller.id, target: `city-${traveller.home}`, kind: 'home', traveller }
      if (!traveller.trip) return [home]
      return [
        home,
        { source: traveller.id, target: `waypoint-${traveller.trip.route}`, kind: 'waypoint', traveller },
        { source: traveller.id, target: `city-${traveller.trip.city}`, kind: 'away', traveller },
      ]
    }),
  ]
  let links = tie()

  // The strengths go to the simulation directly. They line up with the links it holds,
  // which the layer reports after each load: until a new set of links is in, the strengths
  // are for the old one, weighted by the travellers' current trips — for the frame or so
  // after a shuffle, an old away tie pulls by the new trip's progress.
  let graph: Graph | undefined
  let loadedLinks: readonly StoryLink[] = []
  const degree = new Map<string, number>()
  // cosmos.gl splits a spring's pull between its two ends by degree — the better-connected
  // end moves less — and takes the square root of the strength. A traveller's end of each
  // tie gets only its share (the other end's share moves nothing: cities and waypoints are
  // pinned); dividing that out and squaring leaves each tie pulling with exactly its curve
  // weight, so the traveller rests on the route's curve, `progress` along it.
  const sendStrengths = (): void => {
    if (!graph || loadedLinks.length === 0) return // nothing loaded yet
    const strengths = new Float32Array(loadedLinks.length)
    loadedLinks.forEach((link, i) => {
      if (link.kind === 'route') return // between pinned cities: nothing to pull
      const weight = curveWeights(link.traveller.progress)[link.kind]
      const anchorDegree = degree.get(link.target) ?? 1
      const share = anchorDegree / (anchorDegree + (degree.get(link.source) ?? 1))
      strengths[i] = (weight / share) ** 2
    })
    graph.setLinkStrength(strengths)
    graph.render()
  }

  const deck = new Deck({
    parent: div,
    views: new MapView({ repeat: false }),
    initialViewState: { longitude: 20, latitude: 22, zoom: 1.4, minZoom: 0.5, maxZoom: 8 },
    // cosmos's view cannot express pitch or bearing: the map stays flat and north-up
    controller: { dragRotate: false, touchRotate: false, keyboard: false },
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

  const CITY_SHAPES = [PointShape.Star, PointShape.Hexagon, PointShape.Square]
  const graphLayer = (): Layer =>
    new CosmosGraphLayer<StoryPoint, StoryLink>({
      id: 'graph',
      points,
      links,
      getPointId: (p): string => p.id,
      getPointPosition: (p): [number, number] | undefined => seeds.get(p.id),
      getPointColor: (p): [number, number, number, number] => [...(PALETTE[p.home % PALETTE.length] as [number, number, number]), 235],
      // Sizes scale with the zoom (scalePointsOnZoom), so they are in space units: at the
      // opening zoom a space unit is about a third of a pixel
      getPointSize: (p): number => (p.kind === 'city' ? 42 : p.kind === 'traveller' ? 14 : 0),
      // The routes are drawn; the ties are springs and nothing else
      getLinkColor: [150, 170, 220, 150],
      getLinkWidth: (l): number => (l.kind === 'route' ? 1.5 : 0),
      // The graph lives in the map's space
      modelMatrix: MODEL_MATRIX,
      config: {
        spaceSize: SPACE,
        scalePointsOnZoom: true,
        curvedLinks: true,
        curvedLinkWeight: CURVE_WEIGHT,
        curvedLinkControlPointDistance: CURVE_CONTROL_DISTANCE,
        linkArrowsSizeScale: 1.2,
        // Routes are long on screen: do not fade them
        linkVisibilityMinTransparency: 1,
        // deck clips what is off screen; cosmos's own culling only costs here
        pointOcclusionCulling: false,
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
      // The cities and the waypoints stay on their places; the travellers move
      onGraphCreated: (created): void => {
        graph = created
        created.setPinnedPoints(pinnedIndices)
      },
      // A new set of links is in: shapes, arrows and strengths follow its order from now on
      onGraphDataLoaded: (info): void => {
        if (info.pointsLoaded) {
          info.graph.setPointShapes(Float32Array.from(points, (p) => (
            p.kind === 'city' ? (CITY_SHAPES[p.home % CITY_SHAPES.length] as number) : p.kind === 'traveller' ? PointShape.Circle : PointShape.None
          )))
        }
        if (!info.linksLoaded || !info.links) return
        loadedLinks = info.links
        info.graph.setLinkArrows(loadedLinks.map((l) => l.kind === 'route'))
        degree.clear()
        for (const { source, target } of loadedLinks) {
          degree.set(source, (degree.get(source) ?? 0) + 1)
          degree.set(target, (degree.get(target) ?? 0) + 1)
        }
        sendStrengths()
      },
    })

  // The cities are pinned, so their names sit at fixed places
  const cityLabels: CityLabel[] = CITIES.map((city) => ({ name: city.name, position: city.lngLat }))
  const labels = (): Layer => new TextLayer<CityLabel>({
    id: 'city-labels',
    data: cityLabels,
    getPosition: (d): [number, number] => d.position,
    getText: (d): string => d.name,
    getSize: 13,
    getColor: [255, 255, 255, 235],
    getTextAnchor: 'start',
    getPixelOffset: [12, -12],
    characterSet: 'auto',
  })

  // A new links array, which the layer loads on its next update
  const render = (): void => {
    links = tie()
    deck.setProps({ layers: [countries(), graphLayer(), labels()] })
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
        // At least one: a trip this trickle just started has run for no time at all
        const roundTrips = Math.max(1, Math.ceil((now - point.trip.startedAt) / point.trip.period))
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
  div.append(actions, status)

  render()
  animationFrame = requestAnimationFrame(tick)

  return {
    div,
    destroy: (): void => {
      cancelAnimationFrame(animationFrame)
      // The layer owns the graph: finalizing deck finalizes the layer, which destroys it
      deck.finalize()
    },
  }
}
