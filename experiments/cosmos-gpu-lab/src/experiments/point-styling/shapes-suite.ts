import type { CheckResult, LiveCheckItem } from '../../runtime/live-checks'
import { dimensions, type Backend } from './backend'
import { DEFAULTS, fixture, type Settings } from './data'
import { fractionalSpriteSpan } from './fractional'
import { compareSnapshots, evaluatePracticalBoundary, type Comparison, type PracticalBoundary } from './reference'
import type { StylingWebGL } from './webgl'

export type ShapeScene = 'shapes' | 'edge-cases' | 'fractional'
type ShapeTrial = LiveCheckItem & {
  scene: ShapeScene;
  ratio: number;
  zoom?: number;
  scaleOnZoom?: boolean;
  omitSubpixel?: boolean;
  boundary?: boolean;
  thinIds?: number[];
}

export const shapeGroups: Array<{ heading: string; items: ShapeTrial[] }> = [
  {
    heading: 'Do all eight shapes and their inset strokes match?',
    items: [
      {
        id: 'shapes-1x',
        title: 'Fill and stroke',
        description: 'Compare the filled and stroked rows at one device pixel per CSS pixel.',
        scene: 'shapes',
        ratio: 1,
        recorded: 'passed',
      },
      {
        id: 'shapes-2x',
        title: 'Double pixel density',
        description: 'Compare the same shapes when each CSS pixel spans two device pixels per axis.',
        scene: 'shapes',
        ratio: 2,
        recorded: 'passed',
      },
      {
        id: 'shapes-scaled',
        title: 'Zoom out',
        description: 'At half zoom, points shrink with the camera.',
        scene: 'shapes',
        ratio: 1,
        zoom: 0.5,
        recorded: 'passed',
      },
      {
        id: 'shapes-constant',
        title: 'Hold point size',
        description: 'At the same half zoom, point centers move while their diameters stay fixed.',
        scene: 'shapes',
        ratio: 1,
        zoom: 0.5,
        scaleOnZoom: false,
        recorded: 'passed',
      },
    ],
  },
  {
    heading: 'Do defaults, hidden points and size limits match?',
    items: [
      {
        id: 'edge-cases-1x',
        title: 'Defaults and visibility',
        description: 'Check missing styles, zero size, transparent or absent points, size caps and a subpixel circle.',
        scene: 'edge-cases',
        ratio: 1,
        recorded: 'passed',
      },
      {
        id: 'defaults-2x',
        title: 'Defaults at double density',
        description: 'Check the same defaults, capped strokes and translucent fills with the subpixel circle omitted.',
        scene: 'edge-cases',
        ratio: 2,
        omitSubpixel: true,
        recorded: 'passed',
      },
    ],
  },
  {
    heading: 'Do tiny and fractional circles meet the one-pixel boundary rule?',
    items: [
      {
        id: 'edge-cases-2x',
        title: 'Half-pixel circle',
        description: 'Restore the half-CSS-pixel circle at double density and check that it paints alongside the other points.',
        scene: 'edge-cases',
        ratio: 2,
        boundary: true,
        thinIds: [6],
        recorded: 'passed',
      },
      {
        id: 'fractional-1x',
        title: 'Fractional circles at 1×',
        description: 'Check fractional centers and diameters, including five circles at most two device pixels wide.',
        scene: 'fractional',
        ratio: 1,
        boundary: true,
        thinIds: [0, 1, 2, 3, 4],
        recorded: 'passed',
      },
      {
        id: 'fractional-2x',
        title: 'Fractional circles at 2×',
        description: 'Check half-pixel edge ties against the CPU outline and keep all three thin circles visible.',
        scene: 'fractional',
        ratio: 2,
        boundary: true,
        thinIds: [0, 1, 2],
        recorded: 'passed',
      },
    ],
  },
]

const trials = new Map(shapeGroups.flatMap(group => group.items.map(trial => [trial.id, trial] as const)))

function strictDifferences (check: Comparison): string {
  return `${check.idDisagreements} ID differences, ${check.webglReferenceFailures}/${check.webgpuReferenceFailures} WebGL/WebGPU CPU mask differences, ` +
    `${check.colorFailures} pixels beyond 2/255 and ${check.webglInvisiblePicks + check.webgpuInvisiblePicks} invisible picks`
}

function boundaryDifferences (check: PracticalBoundary): string {
  const outside = check.outside
  return `${outside.idDisagreements} ID, ${outside.webglReferenceFailures + outside.webgpuReferenceFailures} mask and ${outside.colorFailures} color ` +
    `differences outside the edge band, ${check.wrongObjectPixels} wrong edge IDs, ${check.webglInvisiblePicks + check.webgpuInvisiblePicks} invisible picks ` +
    `and ${check.vanishedPointIds.length} missing thin points`
}

type ShapeResult = CheckResult & {
  scene: ShapeScene; settings: Settings; strictControl: Comparison; strictCandidate: Comparison;
  practicalControl: PracticalBoundary; practicalCandidate: PracticalBoundary;
  webglSpriteSpan?: number;
}

export async function runShapeTrial (id: string, gl: StylingWebGL, gpu: Backend): Promise<ShapeResult> {
  const trial = trials.get(id)
  if (!trial) throw new Error(`Unknown shape check: ${id}`)
  const { scene, ratio, zoom = 1, scaleOnZoom = true } = trial
  const settings = { ...DEFAULTS, ratio, zoom, scaleOnZoom }
  const points = fixture(scene)
  // Keep the original point indices when isolating the whole-size defaults.
  if (trial.omitSubpixel) points.find(p => p.size === 0.5)!.absent = true
  const legacy = await gl.render(points, settings, false, 'production', false)
  const control = await gpu.render(points, settings, false, 'production', false)
  const candidate = await gpu.render(points, settings, false, 'explicit', false)
  const [width, height] = dimensions(settings)
  if ([legacy, control, candidate].some(s => s.width !== width || s.height !== height)) throw new Error(`Expected a ${width} × ${height} framebuffer.`)
  const strictControl = compareSnapshots(legacy, control, points, settings)
  const strictCandidate = compareSnapshots(legacy, candidate, points, settings)
  const practicalControl = evaluatePracticalBoundary(legacy, control, points, settings, strictControl)
  const practicalCandidate = evaluatePracticalBoundary(legacy, candidate, points, settings, strictCandidate)
  const issues: string[] = []
  if (scene !== 'fractional' && !strictControl.valid) issues.push(`Production control: ${strictDifferences(strictControl)}.`)
  if (!trial.boundary && !strictCandidate.valid) issues.push(`Closed bounds: ${strictDifferences(strictCandidate)}.`)
  if (!practicalControl.valid) issues.push(`Production edge check: ${boundaryDifferences(practicalControl)}.`)
  if (!practicalCandidate.valid) issues.push(`Closed edge check: ${boundaryDifferences(practicalCandidate)}.`)
  if (trial.boundary && strictCandidate.webgpuReferenceFailures) {
    issues.push(`Closed bounds missed the CPU mask at ${strictCandidate.webgpuReferenceFailures} pixels.`)
  }
  if (trial.thinIds && trial.thinIds.join(',') !== practicalCandidate.thinPointIds.join(',')) issues.push('The expected thin point IDs were not checked.')
  let webglSpriteSpan: number | undefined
  let observation: string | undefined
  if (scene === 'fractional' && ratio === 1) {
    // The optional float readback describes the adapter. The parity decision uses the ordinary color and ID images.
    try { webglSpriteSpan = await fractionalSpriteSpan(gl, points, settings) } catch { /* Float probes can be unavailable. */ }
    observation = webglSpriteSpan === undefined
      ? 'WebGL sprite span unavailable on this GPU.'
      : `For the 13.3 px circle, WebGL’s sprite coordinates span ${webglSpriteSpan.toFixed(2)} device pixels.`
  }
  return {
    scene,
    settings,
    strictControl,
    strictCandidate,
    practicalControl,
    practicalCandidate,
    webglSpriteSpan,
    status: issues.length ? 'failed' : 'passed',
    detail: issues.join(' ') || observation,
  }
}
