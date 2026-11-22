import type { SceneDefinition } from './types'

type Color = readonly [number, number, number]

const spectral: readonly Color[] = [
  [0.25, 0.88, 0.97],
  [0.43, 0.39, 0.94],
  [0.87, 0.30, 0.65],
  [1, 0.48, 0.37],
  [1, 0.77, 0.40],
]

function paint (colors: Float32Array, index: number, value: number, alpha: number): void {
  const scaled = Math.max(0, Math.min(0.999999, value)) * (spectral.length - 1)
  const start = Math.floor(scaled)
  const blend = scaled - start
  const a = spectral[start]!
  const b = spectral[start + 1]!
  colors[index * 4] = a[0] + (b[0] - a[0]) * blend
  colors[index * 4 + 1] = a[1] + (b[1] - a[1]) * blend
  colors[index * 4 + 2] = a[2] + (b[2] - a[2]) * blend
  colors[index * 4 + 3] = alpha
}

/** A fourth-order step of Lorenz's original σ = 10, ρ = 28, β = 8/3 system. */
function lorenzStep (state: Float64Array, dt: number): void {
  const x = state[0]!
  const y = state[1]!
  const z = state[2]!
  const dx1 = 10 * (y - x)
  const dy1 = x * (28 - z) - y
  const dz1 = x * y - 8 / 3 * z
  const x2 = x + dx1 * dt / 2
  const y2 = y + dy1 * dt / 2
  const z2 = z + dz1 * dt / 2
  const dx2 = 10 * (y2 - x2)
  const dy2 = x2 * (28 - z2) - y2
  const dz2 = x2 * y2 - 8 / 3 * z2
  const x3 = x + dx2 * dt / 2
  const y3 = y + dy2 * dt / 2
  const z3 = z + dz2 * dt / 2
  const dx3 = 10 * (y3 - x3)
  const dy3 = x3 * (28 - z3) - y3
  const dz3 = x3 * y3 - 8 / 3 * z3
  const x4 = x + dx3 * dt
  const y4 = y + dy3 * dt
  const z4 = z + dz3 * dt
  const dx4 = 10 * (y4 - x4)
  const dy4 = x4 * (28 - z4) - y4
  const dz4 = x4 * y4 - 8 / 3 * z4
  state[0] = x + (dx1 + 2 * dx2 + 2 * dx3 + dx4) * dt / 6
  state[1] = y + (dy1 + 2 * dy2 + 2 * dy3 + dy4) * dt / 6
  state[2] = z + (dz1 + 2 * dz2 + 2 * dz3 + dz4) * dt / 6
}

const LORENZ_TRACKS = 10
const LORENZ_SAMPLES = 3200
const LORENZ_DUST = 6000
const LORENZ_POINTS = LORENZ_TRACKS * LORENZ_SAMPLES + LORENZ_DUST
const LORENZ_LINKS = LORENZ_TRACKS * Math.floor((LORENZ_SAMPLES - 1) / 3)

export const lorenzAttractor: SceneDefinition = {
  id: 'lorenz-attractor',
  title: 'Ten Lorenz Trajectories',
  description: 'Ten trajectories through the same Lorenz system start close together and diverge over time.',
  pointCount: LORENZ_POINTS,
  linkCount: LORENZ_LINKS,
  background: '#111318',
  create: random => {
    const positions = new Float32Array(LORENZ_POINTS * 2)
    const colors = new Float32Array(LORENZ_POINTS * 4)
    const sizes = new Float32Array(LORENZ_POINTS)
    const coordinates = new Float32Array(LORENZ_POINTS * 3)
    const links = new Float32Array(LORENZ_LINKS * 2)
    const linkColors = new Float32Array(LORENZ_LINKS * 4)
    const linkWidths = new Float32Array(LORENZ_LINKS)
    let linkIndex = 0

    for (let track = 0; track < LORENZ_TRACKS; track++) {
      const state = new Float64Array([0.1 + track * 0.00001, 0.2, 0.3])
      for (let burn = 0; burn < 2800 + track * 57; burn++) lorenzStep(state, 0.006)

      for (let sample = 0; sample < LORENZ_SAMPLES; sample++) {
        lorenzStep(state, 0.006)
        const index = track * LORENZ_SAMPLES + sample
        coordinates[index * 3] = state[0]!
        coordinates[index * 3 + 1] = state[1]!
        coordinates[index * 3 + 2] = state[2]!
        const hue = 0.16 + (state[0]! / 42 + 0.5) * 0.63 + Math.sin(state[2]! * 0.13) * 0.16
        const bright = random() > 0.995
        paint(colors, index, hue, bright ? 0.8 : 0.17 + random() * 0.18)
        sizes[index] = bright ? 1.9 + random() * 0.8 : 0.55 + random() * 0.53

        if (sample % 3 === 0 && sample + 3 < LORENZ_SAMPLES) {
          links[linkIndex * 2] = index
          links[linkIndex * 2 + 1] = index + 3
          paint(linkColors, linkIndex, hue, 0.095)
          linkWidths[linkIndex] = 0.38
          linkIndex++
        }
      }
    }

    // A narrow sheath of particles reveals depth without filling the eye of each wing.
    for (let dust = 0; dust < LORENZ_DUST; dust++) {
      const index = LORENZ_TRACKS * LORENZ_SAMPLES + dust
      const source = Math.floor(random() * LORENZ_TRACKS * LORENZ_SAMPLES)
      const spread = Math.pow(random(), 2) * 0.55
      coordinates[index * 3] = coordinates[source * 3]! + (random() - 0.5) * spread
      coordinates[index * 3 + 1] = coordinates[source * 3 + 1]! + (random() - 0.5) * spread
      coordinates[index * 3 + 2] = coordinates[source * 3 + 2]! + (random() - 0.5) * spread
      paint(colors, index, 0.16 + (coordinates[index * 3]! / 42 + 0.5) * 0.63, 0.1 + random() * 0.16)
      sizes[index] = 0.5 + random() * 0.55
    }

    const update = (time: number): void => {
      const yaw = -0.17 + Math.sin(time * 0.09) * 0.19
      const cosine = Math.cos(yaw)
      const sine = Math.sin(yaw)
      const tilt = 0.045 + Math.sin(time * 0.07) * 0.025
      for (let index = 0; index < LORENZ_POINTS; index++) {
        const x = coordinates[index * 3]!
        const y = coordinates[index * 3 + 1]!
        const z = coordinates[index * 3 + 2]! - 25
        positions[index * 2] = (x * cosine + y * sine) / 14.5
        positions[index * 2 + 1] = (z + (y * cosine - x * sine) * tilt) / 33
      }
    }
    update(0)
    return { positions, colors, sizes, links, linkColors, linkWidths, update }
  },
}
