interface Point {
  id: number;
}

interface Link {
  source: number;
  target: number;
}

interface NetworkData {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointSizes: Float32Array;
  links: Float32Array;
  linkColors: Float32Array;
  linkWidths: Float32Array;
  points: Point[];
  connections: Link[];
}

function hslToRgb (hue: number, saturation: number, lightness: number): [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2

  let r, g, b
  if (hue >= 0 && hue < 60) {
    r = c; g = x; b = 0
  } else if (hue >= 60 && hue < 120) {
    r = x; g = c; b = 0
  } else if (hue >= 120 && hue < 180) {
    r = 0; g = c; b = x
  } else if (hue >= 180 && hue < 240) {
    r = 0; g = x; b = c
  } else if (hue >= 240 && hue < 300) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }

  return [r + m, g + m, b + m]
}

function generatePoints (count: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i < count; i++) {
    points.push({ id: i })
  }
  return points
}

function generateConnections (points: Point[]): Link[] {
  const connections: Link[] = []
  const pointCount = points.length

  // Sequential connections
  for (let i = 0; i < pointCount; i++) {
    const nextId1 = (i + 1) % pointCount
    const nextId2 = (i + 2) % pointCount
    connections.push({ source: i, target: nextId1 })
    if (i % 2 === 0) {
      connections.push({ source: i, target: nextId2 })
    }
  }

  // Hub connections
  const hubPoints = [0, 10, 20, 30, 40, 50, 60, 70]
  hubPoints.forEach(hub => {
    for (let i = 1; i <= 5; i++) {
      const targetId = (hub + i * 3) % pointCount
      if (targetId !== hub) {
        connections.push({ source: hub, target: targetId })
      }
    }
  })

  // Cross connections
  for (let i = 0; i < pointCount / 2; i++) {
    const oppositeId = i + Math.floor(pointCount / 2)
    if (i % 3 === 0) {
      connections.push({ source: i, target: oppositeId })
    }
  }

  // Random connections
  for (let i = 0; i < 30; i++) {
    const source = Math.floor(Math.random() * pointCount)
    const target = Math.floor(Math.random() * pointCount)
    if (source !== target) {
      const exists = connections.some(conn =>
        (conn.source === source && conn.target === target) ||
        (conn.source === target && conn.target === source)
      )
      if (!exists) {
        connections.push({ source, target })
      }
    }
  }

  return connections
}

function generatePointPositions (points: Point[]): Float32Array {
  const radius = 100
  const positions = new Float32Array(points.length * 2)

  points.forEach((point, i) => {
    const angle = (i / points.length) * Math.PI * 2
    const pointRadius = radius + (Math.random() - 0.5) * 20

    positions[i * 2] = Math.cos(angle) * pointRadius
    positions[i * 2 + 1] = Math.sin(angle) * pointRadius
  })

  return positions
}

function generatePointColors (points: Point[]): Float32Array {
  const colors = new Float32Array(points.length * 4)

  points.forEach((point, i) => {
    const hue = (point.id / points.length) * 360
    const [r, g, b] = hslToRgb(hue, 0.8, 0.6)

    colors[i * 4] = r
    colors[i * 4 + 1] = g
    colors[i * 4 + 2] = b
    colors[i * 4 + 3] = 1.0
  })

  return colors
}

function generatePointSizes (points: Point[]): Float32Array {
  const sizes = new Float32Array(points.length)
  sizes.fill(10)
  return sizes
}

function generateLinkData (connections: Link[], points: Point[]): {
  links: Float32Array;
  linkColors: Float32Array;
  linkWidths: Float32Array;
} {
  const links = new Float32Array(connections.length * 2)
  const linkColors = new Float32Array(connections.length * 4)
  const linkWidths = new Float32Array(connections.length)

  connections.forEach((connection, i) => {
    links[i * 2] = connection.source
    links[i * 2 + 1] = connection.target

    // Color links based on average hue of connected points
    const sourceHue = (connection.source / points.length) * 360
    const targetHue = (connection.target / points.length) * 360

    let avgHue
    const hueDiff = Math.abs(targetHue - sourceHue)
    if (hueDiff > 180) {
      avgHue = ((sourceHue + targetHue + 360) / 2) % 360
    } else {
      avgHue = (sourceHue + targetHue) / 2
    }

    const [r, g, b] = hslToRgb(avgHue, 0.7, 0.5)

    linkColors[i * 4] = r
    linkColors[i * 4 + 1] = g
    linkColors[i * 4 + 2] = b
    linkColors[i * 4 + 3] = 0.9

    linkWidths[i] = 2
  })

  return { links, linkColors, linkWidths }
}

export function generateData (pointCount: number = 500): NetworkData {
  const points = generatePoints(pointCount)
  const connections = generateConnections(points)

  const pointPositions = generatePointPositions(points)
  const pointColors = generatePointColors(points)
  const pointSizes = generatePointSizes(points)

  const { links, linkColors, linkWidths } = generateLinkData(connections, points)

  return {
    pointPositions,
    pointColors,
    pointSizes,
    links,
    linkColors,
    linkWidths,
    points,
    connections,
  }
}
