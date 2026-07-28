/**
 * Demonstrates point position transitions using the cities CSV.
 */

import { Graph, TransitionEasing, defaultConfigValues, getRgbaColor } from '@cosmos.gl/graph'

import './transition.css'

const CITIES_URL = 'https://assets.cosmograph.app/cities.csv'

interface City {
  continent: string;
  population: number;
  mercatorX: number;
  mercatorY: number;
  barX: number;
  barY: number;
  latX: number;
  latY: number;
}

interface Layout {
  name: string;
  x: 'mercatorX' | 'barX' | 'latX';
  y: 'mercatorY' | 'barY' | 'latY';
}

const LAYOUTS: Layout[] = [
  { name: 'Mercator', x: 'mercatorX', y: 'mercatorY' },
  { name: 'Latitude', x: 'latX', y: 'latY' },
  { name: 'Population bars', x: 'barX', y: 'barY' },
]

const CONTINENT_COLORS = new Map<string, string>([
  ['Africa', '#fdb863'],
  ['America', '#a090f0'],
  ['Asia', '#a0e080'],
  ['Europe', '#e86020'],
  ['Oceania', '#40b8e8'],
])

interface CityData {
  cities: City[];
  colors: Float32Array;
  sizes: Float32Array;
}

function parseCitiesCsv (text: string): City[] {
  const lines = text.trim().split(/\r?\n/)

  return lines.slice(1).flatMap((line) => {
    const columns = line.split(',').slice(-8)
    const mercatorX = Number(columns[0])
    const mercatorY = Number(columns[1])
    const barX = Number(columns[2])
    const barY = Number(columns[3])
    const latX = Number(columns[4])
    const latY = Number(columns[5])
    const population = Number(columns[6])
    const continent = columns[7]

    if (
      continent === undefined ||
      !Number.isFinite(mercatorX) ||
      !Number.isFinite(mercatorY) ||
      !Number.isFinite(barX) ||
      !Number.isFinite(barY) ||
      !Number.isFinite(latX) ||
      !Number.isFinite(latY) ||
      !Number.isFinite(population)
    ) {
      return []
    }

    return [{
      continent,
      population,
      mercatorX,
      mercatorY,
      barX,
      barY,
      latX,
      latY,
    }]
  })
}

function createPositions (cities: City[], layoutIndex: number): Float32Array {
  const layout = LAYOUTS[layoutIndex] ?? LAYOUTS[0]!
  const positions = new Float32Array(cities.length * 2)

  cities.forEach((city, i) => {
    const offset = i * 2
    positions[offset] = city[layout.x]
    positions[offset + 1] = city[layout.y]
  })

  return positions
}

function createColors (cities: City[]): Float32Array {
  const colors = new Float32Array(cities.length * 4)

  cities.forEach((city, i) => {
    const color = CONTINENT_COLORS.get(city.continent) ?? '#b3b3b3'
    const rgba = getRgbaColor(color)
    const offset = i * 4
    colors[offset] = rgba[0]
    colors[offset + 1] = rgba[1]
    colors[offset + 2] = rgba[2]
    colors[offset + 3] = 0.85
  })

  return colors
}

function createSizes (cities: City[]): Float32Array {
  const sizes = new Float32Array(cities.length)
  let maxPopulation = 0

  for (const city of cities) {
    maxPopulation = Math.max(maxPopulation, city.population)
  }

  cities.forEach((city, i) => {
    const population = city.population
    sizes[i] = 5 + (Math.sqrt(population) / Math.sqrt(maxPopulation)) * 85
  })

  return sizes
}

async function loadCities (): Promise<CityData> {
  const response = await fetch(CITIES_URL)
  if (!response.ok) throw new Error(`Failed to fetch cities: ${response.status}`)

  const cities = parseCitiesCsv(await response.text()).filter(city => city.continent !== 'Antarctica')
  return {
    cities,
    colors: createColors(cities),
    sizes: createSizes(cities),
  }
}

export const citiesTransition = async (): Promise<{
  graph: Graph;
  div: HTMLDivElement;
  destroy?: () => void;
}> => {
  const { cities, colors, sizes } = await loadCities()

  let layoutIndex = 0
  let loopIntervalId: ReturnType<typeof setInterval> | undefined

  const div = document.createElement('div')
  div.className = 'app'
  div.style.background = defaultConfigValues.backgroundColor

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const layoutAction = document.createElement('div')
  layoutAction.className = 'action'
  layoutAction.textContent = LAYOUTS[layoutIndex]!.name
  layoutAction.title = 'Switch to the next city layout.'

  const pausePlayAction = document.createElement('div')
  pausePlayAction.className = 'action'
  pausePlayAction.textContent = 'Pause'
  pausePlayAction.title = 'Pause or resume the auto-loop.'

  const fitViewAction = document.createElement('div')
  fitViewAction.className = 'action'
  fitViewAction.textContent = 'FitView'
  fitViewAction.title = 'Fit the camera to current points.'

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  actionsDiv.appendChild(layoutAction)
  actionsDiv.appendChild(pausePlayAction)
  actionsDiv.appendChild(fitViewAction)
  div.appendChild(actionsDiv)

  const graph = new Graph(graphDiv, {
    enableSimulation: false,
    pointDefaultSize: 2,
    pointOpacity: 1,
    scalePointsOnZoom: true,
    transitionDuration: 2000,
    transitionEasing: TransitionEasing.CubicInOut,
    rescalePositions: true,
    fitViewPadding: 0.12,
    attribution: [
      [
        'dataset by <a href="https://lekschas.de" style="color: var(--cosmosgl-attribution-color);" target="_blank">Fritz Lekschas</a>,',
        'from <a href="https://jupyter-scatter.dev" style="color: var(--cosmosgl-attribution-color);" target="_blank">Jupyter Scatter</a>',
        'and <a href="https://www.geonames.org" style="color: var(--cosmosgl-attribution-color);" target="_blank">GeoNames</a>',
      ].join(' '),
    ].join('<br>'),
  })

  const renderLayout = (): void => {
    graph.setPointPositions(createPositions(cities, layoutIndex))
    graph.render()
    layoutAction.textContent = LAYOUTS[layoutIndex]!.name
  }

  const stopLoopTimer = (): void => {
    if (loopIntervalId === undefined) return
    clearInterval(loopIntervalId)
    loopIntervalId = undefined
  }

  const showNextLayout = (): void => {
    layoutIndex = (layoutIndex + 1) % LAYOUTS.length
    renderLayout()
  }

  const startLoop = (): void => {
    loopIntervalId = setInterval(showNextLayout, 1800)
  }

  graph.setPointPositions(createPositions(cities, layoutIndex))
  graph.setPointColors(colors)
  graph.setPointSizes(sizes)
  graph.render()
  graph.fitView()
  startLoop()

  layoutAction.addEventListener('click', showNextLayout)

  pausePlayAction.addEventListener('click', () => {
    if (loopIntervalId !== undefined) {
      stopLoopTimer()
      pausePlayAction.textContent = 'Play'
    } else {
      startLoop()
      pausePlayAction.textContent = 'Pause'
    }
  })

  fitViewAction.addEventListener('click', () => {
    graph.fitView()
  })

  return {
    div,
    graph,
    destroy: (): void => {
      stopLoopTimer()
    },
  }
}
