import type { Backend, Snapshot } from './backend'
import { pick } from './backend'
import { DEFAULTS, fixture, type Point, type Settings } from './data'
import { PACKING_SOURCES, packingLayout, type AtlasImage } from './atlas-packing'
import type { AtlasMutation, DynamicAtlas } from './dynamic-atlas'
import { compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'
import { inspectAtlasIsolation, type IsolationAudit } from './atlas-isolation'
import { inspectForeground, contributionPasses, type ContributionPair } from './tiny-alpha'

function image (width: number, height: number, seed: number, alpha = 255): AtlasImage {
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes.set([40 + (seed + x * 7) % 190, 40 + (seed * 3 + y * 9) % 190, 50 + (seed * 5 + x + y) % 180, alpha], (y * width + x) * 4)
    }
  }
  return { width, height, bytes }
}
export const DYNAMIC_STEPS = [
  { name: 'Initial five images', operation: 'replace', images: PACKING_SOURCES },
  { name: 'Fill image 0 and its holes', operation: 'upload', index: 0, image: image(31, 17, 11) },
  { name: 'Make image 0 transparent', operation: 'upload', index: 0, image: image(31, 17, 27, 0) },
  { name: 'Make the one-texel-wide image opaque', operation: 'upload', index: 4, image: image(1, 11, 31) },
  {
    name: 'Grow and repack six images',
    operation: 'replace',
    images: [[37, 21], [11, 27], [9, 25], [15, 7], [1, 13], [23, 19]].map(([w, h], i) => image(w, h, 43 + i * 13, i === 3 ? 0 : 255)),
  },
  { name: 'Shrink to two images', operation: 'replace', images: [image(19, 9, 71), image(7, 17, 83)] },
  { name: 'Clear every image', operation: 'replace', images: [] },
  { name: 'Restore the five-image set', operation: 'replace', images: PACKING_SOURCES },
  { name: 'Return to the static control', operation: 'restore' },
] as const
export const DYNAMIC_PROFILES = [
  { name: 'Native', settings: {} },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · translucent · reversed', settings: { zoom: 0.5, opacity: 0.35, reverse: true } },
  { name: 'Opacity zero', settings: { opacity: 0 } },
] satisfies Array<{ name: string; settings: Partial<Settings> }>
export const DYNAMIC_ROW_COUNT = DYNAMIC_STEPS.length * DYNAMIC_PROFILES.length * 2
export function dynamicPoints (): Point[] {
  const grid = fixture('atlas-packing-grid'); const overlap = fixture('atlas-packing-overlap')
  return [
    { ...overlap[0], x: 130.5, y: 200.5, size: 108 },
    { ...grid[0], x: 130.5, y: 200.5, imageSize: 62 },
    { ...grid[1], x: 260.5, y: 200.5, shape: 0, size: 42, color: [0.3, 0.55, 0.85, 0.6], imageSize: 58 },
    { ...grid[2], x: 390.5, y: 200.5, imageSize: 46 },
    { ...grid[3], x: 130.5, y: 80.5, imageSize: 26 },
    { ...grid[4], x: 260.5, y: 80.5, imageSize: 22 },
    { ...grid[0], x: 390.5, y: 80.5, image: 5, imageSize: 38 },
  ]
}
export function applyDynamicStep (atlas: DynamicAtlas, index: number): AtlasMutation {
  const step = DYNAMIC_STEPS[index]
  if (!step) throw new Error('Unknown image-update step')
  if (step.operation === 'upload') return atlas.updateImage(step.index, step.image)
  return atlas.replace(step.operation === 'restore' ? undefined : step.images)
}
type Pair = { webgl: Snapshot; webgpu: Snapshot }
export type DynamicRow = {
  step: number; name: string; profile: string; filter: 'nearest' | 'linear'; settings: Settings;
  mutations: { webgl: AtlasMutation; webgpu: AtlasMutation }; paired: Comparison; isolated: IsolationAudit;
  preservation: { webgl: ColorComparison; webgpu: ColorComparison }; contribution: ContributionPair;
  production: Comparison; compatibility: Comparison; restoration?: { webgl: boolean; webgpu: boolean }; passed: boolean;
  probe: { webgl: Array<number | null>; webgpu: Array<number | null> };
}
export async function runDynamicSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: DynamicRow) => void, cancelled: () => boolean
): Promise<DynamicRow[]> {
  const rows: DynamicRow[] = []; const points = dynamicPoints()
  const render = async (settings: Settings, variant: 'production' | 'explicit' | 'eligibility'): Promise<Pair> => ({
    webgl: await backends.webgl.render(points, settings, false, variant, false),
    webgpu: await backends.webgpu.render(points, settings, false, variant, false),
  })
  try {
    for (const profile of DYNAMIC_PROFILES) {
      for (const filter of ['nearest', 'linear'] as const) {
        if (cancelled()) return rows
        for (const backend of Object.values(backends)) backend.atlas.replace()
        const settings: Settings = { ...DEFAULTS, ...profile.settings, imageFilter: filter, atlasPacking: 'npot-square', atlasIsolation: 'texel' }
        const before = await render(settings, 'production'); const beforeCandidate = await render(settings, 'eligibility')
        for (let step = 0; step < DYNAMIC_STEPS.length; step++) {
          if (cancelled()) return rows
          const mutations = { webgl: applyDynamicStep(backends.webgl.atlas, step), webgpu: applyDynamicStep(backends.webgpu.atlas, step) }
          const production = await render(settings, 'production'); const explicit = await render(settings, 'explicit')
          const pair = await render(settings, 'eligibility')
          const paired = await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings)
          const isolated = await inspectAtlasIsolation(pair, points, settings)
          const preservation = { webgl: compareColors(explicit.webgl, pair.webgl), webgpu: compareColors(explicit.webgpu, pair.webgpu) }
          const contribution = await inspectForeground(backends, pair, points, settings, 'eligibility')
          const restoration = step === DYNAMIC_STEPS.length - 1
            ? Object.fromEntries((['webgl', 'webgpu'] as const).map(lane => [lane,
              compareColors(before[lane], production[lane]).changedPixels === 0 && before[lane].ids.every((v, i) => v === production[lane].ids[i]) &&
          compareColors(beforeCandidate[lane], pair[lane]).changedPixels === 0 && beforeCandidate[lane].ids.every((v, i) => v === pair[lane].ids[i]),
            ])) as { webgl: boolean; webgpu: boolean }
            : undefined
          const row: DynamicRow = {
            step,
            name: DYNAMIC_STEPS[step].name,
            profile: profile.name,
            filter,
            settings,
            mutations,
            paired,
            isolated,
            preservation,
            contribution,
            restoration,
            production: await compareSnapshotsAsync(production.webgl, production.webgpu, points, settings),
            compatibility: await compareSnapshotsAsync(production.webgl, pair.webgpu, points, settings),
            probe: {
              webgl: [pick(pair.webgl, 130, 200), pick(pair.webgl, 111, 200), pick(pair.webgl, 390, 80)],
              webgpu: [pick(pair.webgpu, 130, 200), pick(pair.webgpu, 111, 200), pick(pair.webgpu, 390, 80)],
            },
            passed: paired.valid && isolated.valid && contributionPasses(contribution) &&
            preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 &&
            (!restoration || (restoration.webgl && restoration.webgpu)),
          }
          rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
        }
      }
    }
  } finally { for (const backend of Object.values(backends)) backend.atlas.replace() }
  return rows
}
export function renderDynamicRows (host: HTMLElement, rows: DynamicRow[]): void {
  const restored = packingLayout('npot-square')
  host.innerHTML = `<p>${DYNAMIC_ROW_COUNT} rows · nine ordered updates × nearest/linear × four profiles. ${rows.filter(r => r.passed).length}
    passed / ${rows.length} checked. Exact IDs/CPU masks, 2/255 colors, source visibility and pick-only color preservation apply.
    Static control restoration must be byte-identical. Production compatibility remains separate.</p>
    <table data-dynamic-table><thead><tr><th>Update / profile / filter</th><th>Images / atlas</th><th>Candidate</th><th>CPU masks · GL / GPU</th>
      <th>CPU colors beyond 2/255 · GL / GPU</th><th>Production compatible</th><th>Static restoration</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.step + 1}. ${r.name}<br>${r.profile} · ${r.filter}</td>
        <td>${r.mutations.webgl.operation === 'restore'
    ? `${restored.images.length} / ${restored.width} × ${restored.height} · static`
    : `${r.mutations.webgl.images} / ${r.mutations.webgl.width} × ${r.mutations.webgl.height}`}</td><td>${r.passed ? 'Pass' : 'Fail'}</td>
        <td>${r.isolated.masks.webglReferenceFailures} / ${r.isolated.masks.webgpuReferenceFailures}</td>
        <td>${r.isolated.colors.webgl.budgetFailures} / ${r.isolated.colors.webgpu.budgetFailures}</td><td>${r.compatibility.valid ? 'Pass' : 'Fail'}</td>
        <td>${r.restoration ? r.restoration.webgl && r.restoration.webgpu ? 'Pass' : 'Fail' : 'Unchecked'}</td></tr>`).join('')}</tbody></table>`
}
