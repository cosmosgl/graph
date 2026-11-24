type Pick = 'Background' | 'Point 0' | 'Point 3' | 'Link 1'
type ScaleProbe = { xy: [number, number]; description: string; expected: Pick; rgba: number[] }
const colors = new Map<Pick, number[]>([
  ['Background', [24, 32, 43, 255]],
  ['Point 0', [242, 107, 71, 255]],
  ['Point 3', [167, 146, 232, 255]],
  ['Link 1', [255, 199, 107, 255]],
])

// The same six CSS coordinates in both topologies, frozen from two native
// WebGL replays before inspecting WebGPU. The last three change ownership.
const probes: { xy: [number, number]; description: string; expected: [Pick, Pick] }[] = [
  { xy: [144, 96], description: 'Isolated pin', expected: ['Point 0', 'Point 0'] },
  { xy: [12, 12], description: 'Clear background', expected: ['Background', 'Background'] },
  { xy: [190, 71], description: 'Gold link interior', expected: ['Link 1', 'Link 1'] },
  { xy: [169, 125], description: 'Previous endpoint', expected: ['Point 3', 'Background'] },
  { xy: [173, 115], description: 'Vacated link', expected: ['Link 1', 'Background'] },
  { xy: [178, 101], description: 'Moving endpoint over its link', expected: ['Link 1', 'Point 3'] },
]

export function scaleProbes (tick: number): ScaleProbe[] {
  if (tick !== 0 && tick !== 1) return []
  return probes.map(({ xy, description, expected }) => ({ xy, description, expected: expected[tick], rgba: colors.get(expected[tick])! }))
}
