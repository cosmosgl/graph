import { karateEdges } from '../integrated-webgpu/karate'
export function member (id: number): { id: number; neighbors: number[]; strength: number } {
  if (!Number.isInteger(id) || id < 0 || id >= 34) throw new Error('Choose a member from 0 to 33')
  const edges = karateEdges.filter(([a, b]) => a === id || b === id)
  return {
    id,
    neighbors: edges.map(([a, b]) => a === id ? b : a).sort((a, b) => a - b),
    strength: edges.reduce((sum, [, , weight]) => sum + weight, 0),
  }
}
export function pointSize (id: number, degree: boolean): number { return degree ? 6 + member(id).neighbors.length / 3 : 6 }
