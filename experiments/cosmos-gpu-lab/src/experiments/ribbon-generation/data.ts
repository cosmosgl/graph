import { WIDTH, HEIGHT, type Scene } from '../curved-links/data'
export type Distribution = 'short' | 'overlap'
export function makeScene (count: number, distribution: Distribution): Scene {
  if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('Choose 1–100,000 links')
  const scene: Scene = { points: [], links: [] }; let seed = 123456789
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < count; i++) {
    const x = 30 + random() * (WIDTH - 100); const y = 50 + random() * (HEIGHT - 100)
    const length = distribution === 'short' ? 8 + random() * 24 : 100 + random() * 220
    scene.points.push({ x, y }, { x: Math.min(WIDTH - 10, x + length), y: y + (random() - 0.5) * 30 })
    scene.links.push({ source: i * 2, target: i * 2 + 1, width: 1.5, color: [0.67, 0.78, 0.91, 0.15] })
  }
  return scene
}
export function changedPixels (a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error('Snapshot size mismatch')
  let changed = 0
  for (let i = 0; i < a.length; i += 4) if (a.subarray(i, i + 4).some((v, c) => v !== b[i + c])) changed++
  return changed
}

export function firstDifference (a: Uint8Array, b: Uint8Array, width: number):
{ x: number; y: number; baseline: number[]; candidate: number[] } | null {
  for (let i = 0; i < a.length; i += 4) {
    if (a.subarray(i, i + 4).some((v, c) => v !== b[i + c])) {
      return { x: (i / 4) % width, y: Math.floor(i / 4 / width), baseline: [...a.subarray(i, i + 4)], candidate: [...b.subarray(i, i + 4)] }
    }
  }
  return null
}
