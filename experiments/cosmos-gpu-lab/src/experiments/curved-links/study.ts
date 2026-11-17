import { gradientScene, type GradientPreset } from '../straight-links/gradient-fixtures'
import { compareColors, type ColorResult } from '../straight-links/reference'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, FIXTURES, PROFILES, fixture, type Scene, type Settings, type Variant, type Fixture } from './data'
import { compare, reference, type Comparison } from './reference'
export type Pair = { webgl: Snapshot; webgpu: Snapshot }
export type Visibility = { webgl: number; webgpu: number; unknown: { webgl: number; webgpu: number }; checked: { webgl: number[]; webgpu: number[] } }
async function sourceVisibility (backends: { webgl: Backend; webgpu: Backend }, pair: Pair, scene: Scene,
  settings: Settings, variant: Variant): Promise<Visibility> {
  const result: Visibility = { webgl: 0, webgpu: 0, unknown: { webgl: 0, webgpu: 0 }, checked: { webgl: [], webgpu: [] } }
  for (const lane of ['webgl', 'webgpu'] as const) {
    const image = pair[lane]; const ids = new Set<number>()
    const idAt = (i: number): number => image.ids[i] + image.ids[i + 1] * 256 + image.ids[i + 2] * 65536 - 1
    for (let i = 0; i < image.ids.length; i += 4) {
      const id = idAt(i)
      if (id < 0) continue
      const index = id - settings.indexOffset
      if (index < 0 || index >= scene.links.length) result.unknown[lane]++
      else ids.add(index)
    }
    for (const id of ids) {
      result.checked[lane].push(id)
      const input = { ...scene, links: scene.links.map((l, i) => i === id ? l : { ...l, width: 0 }) }
      const isolated = await backends[lane].render(input, settings, variant, false)
      for (let i = 0; i < image.ids.length; i += 4) {
        if (idAt(i) === id + settings.indexOffset && isolated.color[i + 3] === 0) result[lane]++
      }
    }
  }
  return result
}
export type Evidence = { triangles: number; production: Comparison; candidate: Comparison; compatibility: Comparison; front: Comparison;
  frontPreservation: { webgl: ColorResult; webgpu: ColorResult };
  frontSources: Visibility; frontPassed: boolean;
  preservation: { webgl: ColorResult; webgpu: ColorResult }; sourceVisibility: { production: Visibility; candidate: Visibility };
  productionPassed: boolean; passed: boolean; }
export async function assess (backends: { webgl: Backend; webgpu: Backend }, scene: Scene, settings: Settings,
  display?: Variant): Promise<{ frames: Record<Variant, Pair>; evidence: Evidence }> {
  const frames = {
    production: {
      webgl: await backends.webgl.render(scene, settings, 'production', display === 'production'),
      webgpu: await backends.webgpu.render(scene, settings, 'production', display === 'production'),
    },
    visible: {
      webgl: await backends.webgl.render(scene, settings, 'visible', display === 'visible'),
      webgpu: await backends.webgpu.render(scene, settings, 'visible', display === 'visible'),
    },
  }
  const frontFrames = {
    webgl: await backends.webgl.render(scene, settings, 'front', display === 'front'),
    webgpu: await backends.webgpu.render(scene, settings, 'front', display === 'front'),
  }
  const allFrames = { ...frames, front: frontFrames }
  const ref = reference(scene, settings)
  const production = await compare(frames.production.webgl, frames.production.webgpu, ref)
  const front = await compare(frontFrames.webgl, frontFrames.webgpu, ref)
  const frontPreservation = {
    webgl: compareColors(frames.production.webgl.color, frontFrames.webgl.color),
    webgpu: compareColors(frames.production.webgpu.color, frontFrames.webgpu.color),
  }
  const frontSources = await sourceVisibility(backends, frontFrames, scene, settings, 'front')
  const candidate = await compare(frames.visible.webgl, frames.visible.webgpu, ref)
  const compatibility = await compare(frames.production.webgl, frames.visible.webgpu, ref)
  const preservation = {
    webgl: compareColors(frames.production.webgl.color, frames.visible.webgl.color),
    webgpu: compareColors(frames.production.webgpu.color, frames.visible.webgpu.color),
  }
  const sources = {
    production: await sourceVisibility(backends, frames.production, scene, settings, 'production'),
    candidate: await sourceVisibility(backends, frames.visible, scene, settings, 'visible'),
  }
  const sourcePass = (v: Visibility): boolean => v.webgl + v.webgpu + v.unknown.webgl + v.unknown.webgpu === 0
  return {
    frames: allFrames,
    evidence: {
      triangles: ref.triangles,
      front,
      frontPreservation,
      frontSources,
      frontPassed: front.passed && sourcePass(frontSources) && frontPreservation.webgl.changedPixels === 0 && frontPreservation.webgpu.changedPixels === 0,
      production,
      candidate,
      compatibility,
      preservation,
      sourceVisibility: sources,
      productionPassed: production.passed && sourcePass(sources.production),
      passed: candidate.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 && sourcePass(sources.candidate),
    },
  }
}
export const ROW_COUNT = FIXTURES.length * PROFILES.length * 2
export type Row = Evidence & { fixture: Fixture; profile: string; settings: Settings }
export async function runSweep (backends: { webgl: Backend; webgpu: Backend }, onRow: (row: Row) => void,
  cancelled: () => boolean, gradient: GradientPreset = 'solid', patternSettings: Pick<Settings, 'pattern' | 'dashLength' | 'dashGap'> = {}): Promise<Row[]> {
  const rows: Row[] = []
  for (const name of FIXTURES) {
    for (const profile of PROFILES) {
      for (const blend of [true, false]) {
        if (cancelled()) return rows
        const settings = { ...DEFAULTS, ...profile.settings, blend, endpointColors: gradient !== 'solid', ...patternSettings }
        const { evidence } = await assess(backends, gradientScene(fixture(name), gradient), settings)
        const label = [profile.name, gradient === 'solid' ? '' : gradient,
          patternSettings.pattern === 'solid' ? '' : patternSettings.pattern].filter(Boolean).join(' · ')
        const row: Row = { fixture: name, profile: label, settings, ...evidence }
        rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return rows
}
export function renderRows (host: HTMLElement, rows: Row[]): void {
  host.innerHTML = `<p>Color-face candidate: ${rows.filter(r => r.frontPassed).length} passed / ${rows.length} checked of ${ROW_COUNT}.
    Previous visible candidate: ${rows.filter(r => r.passed).length} passed. Every original control and rejection remains included.</p>
    <table data-curves-summary><thead><tr><th>Scene</th><th>Color-face passed / checked</th><th>Previous visible passed</th>
      <th>Production passed</th></tr></thead><tbody>
    ${FIXTURES.map(name => {
    const selected = rows.filter(r => r.fixture === name)
    return `<tr><td>${name}</td><td>${selected.filter(r => r.frontPassed).length} / ${selected.length}</td>
      <td>${selected.filter(r => r.passed).length}</td><td>${selected.filter(r => r.productionPassed).length}</td></tr>`
  }).join('')}</tbody></table>
    <table data-curves-sweep><thead><tr><th>Scene / profile / mode</th><th>Previous visible</th><th>Color-face candidate</th><th>IDs</th>
      <th>CPU masks · GL / GPU</th><th>Color failures · pair / CPU GL / CPU GPU</th><th>Invisible · frame / source</th>
      <th>Changed original color · GL / GPU</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.fixture} · ${r.profile}<br>${r.settings.blend ? 'Blended' : 'Hard opaque'}</td>
      <td>${r.passed ? 'Pass' : 'Fail'}</td><td>${r.frontPassed ? 'Pass' : 'Fail'}</td>
      <td>${r.front.idDifferences}</td><td>${r.front.masks.webgl} / ${r.front.masks.webgpu}</td>
      <td>${r.front.colors.budgetFailures} / ${r.front.cpuColors.webgl.budgetFailures} / ${r.front.cpuColors.webgpu.budgetFailures}</td>
      <td>${r.front.invisible.webgl + r.front.invisible.webgpu} / ${r.frontSources.webgl + r.frontSources.webgpu}</td>
      <td>${r.frontPreservation.webgl.changedPixels} / ${r.frontPreservation.webgpu.changedPixels}</td></tr>`).join('')}</tbody></table>
    <p>Detailed counters refer to the color-face candidate. Export JSON also retains every previous visible and production result.</p>`
}
