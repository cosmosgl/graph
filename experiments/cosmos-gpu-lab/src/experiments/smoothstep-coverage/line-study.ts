import { pick } from '../../gpu/rgba-readback'
import { createLinksWebGL } from '../straight-links/webgl'
import { createLinksWebGPU } from '../straight-links/webgpu'
import { DEFAULTS, fixture, type CoverageFormula, type Scene, type Settings } from '../straight-links/data'
import { compare, compareColors, type Comparison, type ColorResult } from '../straight-links/reference'
import type { Backend, Snapshot } from '../straight-links/backend'

export type Lane = 'webgl' | 'webgpu'
export type Sample = { x: number; y: number; carrier: boolean; position: number; smoothing: number; coverage: number;
  color: number[]; picked: number | null; }
export type LineRun = {
  scene: Scene; settings: Settings; shift: number; info: Record<Lane, string>;
  snapshots: Record<Lane, Record<CoverageFormula, Snapshot>>;
  samples: Record<Lane, Record<CoverageFormula, Sample>>;
  pair: Record<CoverageFormula, Comparison>;
  changes: Record<Lane, { color: ColorResult; ids: number }>;
}

function sample (snapshot: Snapshot): Sample {
  if (!snapshot.probe) throw new Error('Line coverage probe is missing')
  const x = 100; const y = 96; const i = (y * snapshot.width + x) * 4
  return {
    x,
    y,
    carrier: snapshot.probe.varying[i + 3] > 0,
    position: snapshot.probe.varying[i],
    smoothing: snapshot.probe.varying[i + 1],
    coverage: snapshot.probe.varying[i + 2],
    color: Array.from(snapshot.color.subarray(i, i + 4)),
    picked: pick(snapshot, x, y),
  }
}

function changedIds (a: Snapshot, b: Snapshot): number {
  let count = 0
  for (let i = 0; i < a.ids.length; i += 4) {
    if (a.ids[i] !== b.ids[i] || a.ids[i + 1] !== b.ids[i + 1] || a.ids[i + 2] !== b.ids[i + 2] || a.ids[i + 3] !== b.ids[i + 3]) count++
  }
  return count
}

export async function compareLine (shift: number, blend: boolean): Promise<LineRun> {
  const input = fixture('ribbons')
  const scene: Scene = {
    points: input.points.map((point, i) => i === 2 || i === 3 ? { ...point, y: point.y + shift } : point),
    links: input.links.map((link, i) => i === 1 ? link : { ...link, width: 0 }),
  }
  const settings: Settings = { ...DEFAULTS, blend }
  const backends: Partial<Record<Lane, Backend>> = {}
  try {
    backends.webgl = await createLinksWebGL(document.createElement('canvas'))
    backends.webgpu = await createLinksWebGPU(document.createElement('canvas'))
    const snapshots = {} as LineRun['snapshots']; const samples = {} as LineRun['samples']
    for (const lane of ['webgl', 'webgpu'] as const) {
      snapshots[lane] = {} as Record<CoverageFormula, Snapshot>; samples[lane] = {} as Record<CoverageFormula, Sample>
      for (const formula of ['descending', 'ascending'] as const) {
        const snapshot = await backends[lane]!.render(scene, { ...settings, coverageFormula: formula }, 'visible', false, true)
        snapshots[lane][formula] = snapshot; samples[lane][formula] = sample(snapshot)
      }
    }
    const pair = {
      descending: await compare(snapshots.webgl.descending, snapshots.webgpu.descending, scene, settings),
      ascending: await compare(snapshots.webgl.ascending, snapshots.webgpu.ascending, scene, settings),
    }
    const changes = {} as LineRun['changes']
    for (const lane of ['webgl', 'webgpu'] as const) {
      changes[lane] = {
        color: compareColors(snapshots[lane].descending.color, snapshots[lane].ascending.color),
        ids: changedIds(snapshots[lane].descending, snapshots[lane].ascending),
      }
    }
    return { scene, settings, shift, info: { webgl: backends.webgl.info, webgpu: backends.webgpu.info }, snapshots, samples, pair, changes }
  } finally { backends.webgpu?.destroy(); backends.webgl?.destroy() }
}
