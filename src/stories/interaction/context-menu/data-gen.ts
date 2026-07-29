const RING_COUNT = 3
const PER_RING = 14
const CENTER = 2048

export const POINT_COUNT = RING_COUNT * PER_RING + 1
export const BASE_LINK_COLOR = '#49566f'
export const BASE_POINT_SIZE = 18
export const BASE_LINK_WIDTH = 3

/**
 * Concentric rings with a hub. Points are large and links long and straight so
 * that both are easy right-click targets — the whole story depends on being
 * able to land the cursor on the thing you meant to restyle.
 */
export function generateContextMenuData (): { pointPositions: Float32Array; links: Float32Array } {
  const pointPositions = new Float32Array(POINT_COUNT * 2)

  pointPositions[0] = CENTER
  pointPositions[1] = CENTER

  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    const radius = 380 + ring * 340
    for (let i = 0; i < PER_RING; i += 1) {
      const index = 1 + ring * PER_RING + i
      // Offset every other ring so points never line up radially and hide
      // the links behind one another.
      const angle = ((i + (ring % 2) * 0.5) / PER_RING) * Math.PI * 2
      pointPositions[index * 2] = CENTER + Math.cos(angle) * radius
      pointPositions[index * 2 + 1] = CENTER + Math.sin(angle) * radius
    }
  }

  const pairs: number[] = []
  for (let i = 0; i < PER_RING; i += 1) pairs.push(0, 1 + i)
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    for (let i = 0; i < PER_RING; i += 1) {
      const index = 1 + ring * PER_RING + i
      const next = 1 + ring * PER_RING + ((i + 1) % PER_RING)
      pairs.push(index, next)
      if (ring < RING_COUNT - 1) pairs.push(index, index + PER_RING)
    }
  }

  return { pointPositions, links: new Float32Array(pairs) }
}

/**
 * Starting colour for a point: hue follows the angle around the ring, so
 * neighbours are always adjacent hues. That is what makes the gradient
 * readable — `linkColorInterpolateFromEndpoints` blends each link between its
 * two endpoints, which shows nothing at all if every point is the same colour.
 */
export function basePointColor (index: number): string {
  if (index === 0) return 'hsl(220, 25%, 92%)'
  const positionInRing = (index - 1) % PER_RING
  const ring = Math.floor((index - 1) / PER_RING)
  const hue = Math.round((positionInRing / PER_RING) * 360)
  return `hsl(${hue}, 72%, ${68 - ring * 7}%)`
}
