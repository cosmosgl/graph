import { createFixture as pointsFixture, type Input, type Parameters as RepulsionParameters } from '../many-body/data'
import type { GraphInput, Parameters as SpringParameters } from '../weighted-links/data'
export const STAGES = ['gravity', 'repulsion', 'incoming', 'outgoing'] as const
export type Stage = typeof STAGES[number]
export type Fixture = 'chain' | 'star' | 'communities' | 'pinned'
export type Settings = { fixture: Fixture; count: number; decay: number }
export const ALPHA_MIN = 0.001
export const GRAVITY = 0.25
export const REPULSION: RepulsionParameters = { alpha: 1, repulsion: 1, friction: 0.85, referenceLength: 4096 }
export const SPRINGS: SpringParameters = {
  spring: 1,
  distance: 10,
  variation: [1, 1],
  alpha: 1,
  friction: 0.85,
  maxStep: 4096,
  collision: false,
  radius: 0,
  padding: 0,
}
export function cool (alpha: number, decay: number): number {
  return alpha + (0 - alpha) * (1 - Math.pow(ALPHA_MIN, 1 / decay))
}
export function createGraph (settings: Settings): { graph: GraphInput; input: Input } {
  if (!Number.isInteger(settings.count) || settings.count < 4 || settings.count > 512 ||
    !Number.isInteger(settings.decay) || settings.decay < 1 || settings.decay > 1000) throw new Error('Invalid combined experiment settings')
  const input = pointsFixture('uniform', settings.count)
  const edges: number[] = []; const add = (a: number, b: number): void => { edges.push(a, b) }
  for (let i = 1; i < settings.count; i++) {
    if (settings.fixture === 'star') add(0, i)
    else if (settings.fixture === 'communities') {
      if (i % 16) { add(i - 1, i); if (i % 16 > 1) add(Math.floor(i / 16) * 16, i) } else add(i - 1, i) // Bridges make the community fixture connected.
    } else add(i - 1, i)
  }
  if (settings.fixture === 'pinned') {
    input.points.set([-64, 0, 1, 0], 0); input.points.set([64, 0, 1, 0], (settings.count - 1) * 4)
  }
  const graph: GraphInput = {
    points: input.points,
    links: new Float32Array(edges),
    weights: new Float32Array(edges.length / 2).fill(1),
    sizes: new Float32Array(settings.count).fill(2),
  }
  return { input, graph }
}
