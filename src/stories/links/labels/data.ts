// Note: This is vibe coding only - quick prototype code for demonstration purposes

const RADIUS = 90
const N = 14

function hslToRgb (h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c; g = x; b = 0
  } else if (h < 120) {
    r = x; g = c; b = 0
  } else if (h < 180) {
    r = 0; g = c; b = x
  } else if (h < 240) {
    r = 0; g = x; b = c
  } else if (h < 300) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }
  return [r + m, g + m, b + m]
}

export function generateLinkSamplingDemoData (): {
  pointPositions: Float32Array;
  links: Float32Array;
  linkColors: Float32Array;
  } {
  const pointPositions = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2
    pointPositions[i * 2] = Math.cos(angle) * RADIUS
    pointPositions[i * 2 + 1] = Math.sin(angle) * RADIUS
  }

  const connections: [number, number][] = []
  for (let i = 0; i < N; i++) {
    connections.push([i, (i + 1) % N])
  }
  connections.push([0, 5], [2, 7], [4, 9], [6, 11], [1, 8], [3, 10])

  const links = new Float32Array(connections.length * 2)
  const linkColors = new Float32Array(connections.length * 4)

  connections.forEach(([s, t], i) => {
    links[i * 2] = s
    links[i * 2 + 1] = t
    const [r, g, b] = hslToRgb((i / Math.max(1, connections.length)) * 320, 0.5, 0.58)
    linkColors[i * 4] = r
    linkColors[i * 4 + 1] = g
    linkColors[i * 4 + 2] = b
    linkColors[i * 4 + 3] = 1
  })

  return {
    pointPositions,
    links,
    linkColors,
  }
}
