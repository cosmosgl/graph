export const POINT_COUNT = 8192

export type PointState = {
  positions: Float32Array;
  velocities: Float32Array;
}

export type Center = {
  x: number;
  y: number;
  count: number;
}

export function createPointState (seed = 0xdecafbad): PointState {
  const positions = new Float32Array(POINT_COUNT * 2)
  const velocities = new Float32Array(POINT_COUNT * 2)
  let value = seed >>> 0

  const random = (): number => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return (value >>> 0) / 0x100000000
  }

  for (let point = 0; point < POINT_COUNT; point += 1) {
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * 0.82
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    const speed = 0.0008 + random() * 0.0014

    positions[point * 2] = x
    positions[point * 2 + 1] = y
    velocities[point * 2] = -Math.sin(angle) * speed + (random() - 0.5) * 0.0005
    velocities[point * 2 + 1] = Math.cos(angle) * speed + (random() - 0.5) * 0.0005
  }

  return { positions, velocities }
}

export function advancePointState (state: PointState): void {
  const { positions, velocities } = state

  for (let index = 0; index < positions.length; index += 2) {
    positions[index] += velocities[index]
    positions[index + 1] += velocities[index + 1]

    if (positions[index] < -0.94 || positions[index] > 0.94) {
      positions[index] = Math.max(-0.94, Math.min(0.94, positions[index]))
      velocities[index] *= -1
    }
    if (positions[index + 1] < -0.94 || positions[index + 1] > 0.94) {
      positions[index + 1] = Math.max(-0.94, Math.min(0.94, positions[index + 1]))
      velocities[index + 1] *= -1
    }
  }
}

export function calculateCpuCenter (positions: Float32Array): Center {
  let x = 0
  let y = 0
  const count = positions.length / 2

  for (let index = 0; index < positions.length; index += 2) {
    x += positions[index]
    y += positions[index + 1]
  }

  return { x: x / count, y: y / count, count }
}
