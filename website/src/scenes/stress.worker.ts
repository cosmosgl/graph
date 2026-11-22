import { STRESS_POINT_COUNTS } from './stress-data'
import type { StressBounds, StressRequest, StressResponse } from './stress-data'

const BLOCK_SIZE = 250_000
const ORIGIN = 2048

function send (response: StressResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer })
}

/** A bounded chaotic orbit, not replicated points or a sampled preview. */
function generate ({ count, seed }: StressRequest): void {
  if (!STRESS_POINT_COUNTS.includes(count)) {
    throw new RangeError('Choose 1, 2, 5 or 10 million points.')
  }
  if (!Number.isFinite(seed)) throw new RangeError('The attractor seed must be finite.')

  const started = performance.now()
  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 0) / 4294967296
  }
  let x = random() - 0.5
  let y = random() - 0.5
  const positions = new Float32Array(count * 2)

  // Clifford map: x' = sin(a y) + c cos(a x), y' = sin(b x) + d cos(b y).
  // These parameters produce broad, interlaced wisps with dark openings.
  const a = -1.7
  const b = 1.8
  const c = -1.9
  const d = -0.4
  for (let iteration = 0; iteration < 5000; iteration++) {
    const nextX = Math.sin(a * y) + c * Math.cos(a * x)
    y = Math.sin(b * x) + d * Math.cos(b * y)
    x = nextX
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let block = 0; block < count; block += BLOCK_SIZE) {
    const end = Math.min(block + BLOCK_SIZE, count)
    for (let index = block; index < end; index++) {
      const nextX = Math.sin(a * y) + c * Math.cos(a * x)
      y = Math.sin(b * x) + d * Math.cos(b * y)
      x = nextX
      positions[index * 2] = x
      positions[index * 2 + 1] = y
      // Measure the stored values so the final framing includes Float32 rounding.
      const storedX = positions[index * 2]!
      const storedY = positions[index * 2 + 1]!
      if (storedX < minX) minX = storedX
      if (storedX > maxX) maxX = storedX
      if (storedY < minY) minY = storedY
      if (storedY > maxY) maxY = storedY
    }
    send({ type: 'progress', generated: end, total: count })
  }

  // Fit the measured attractor into 2.8 × 1.6 normalized units without stretching.
  // Generate directly in the one transferable array; the map's orbit needs no cache.
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const scale = Math.min(2800 / (maxX - minX), 1600 / (maxY - minY))
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  for (let index = 0; index < count; index++) {
    positions[index * 2] = ORIGIN + (positions[index * 2]! - centerX) * scale
    positions[index * 2 + 1] = ORIGIN + (positions[index * 2 + 1]! - centerY) * scale
    const storedX = positions[index * 2]!
    const storedY = positions[index * 2 + 1]!
    if (storedX < minX) minX = storedX
    if (storedX > maxX) maxX = storedX
    if (storedY < minY) minY = storedY
    if (storedY > maxY) maxY = storedY
  }

  const bounds: StressBounds = [minX, minY, maxX, maxY]
  send({ type: 'ready', positions, generationMs: performance.now() - started, bounds }, [positions.buffer])
}

self.addEventListener('message', (event: MessageEvent<StressRequest>): void => {
  try {
    generate(event.data)
  } catch (error: unknown) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Could not generate the attractor.' })
  }
})
