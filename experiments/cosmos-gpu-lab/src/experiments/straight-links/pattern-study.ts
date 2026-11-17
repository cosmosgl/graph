import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import { pick } from '../../gpu/rgba-readback'
import type { Scene, Settings } from './data'
import { compareColors, type Comparison } from './reference'
import { gradientScene } from './gradient-fixtures'
import type { Pattern } from './patterns'

export const PATTERN_PROFILES: Array<{ name: string; settings: Partial<Settings> }> = [
  { name: 'Blended', settings: {} },
  { name: 'Hard', settings: { blend: false } },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Constant screen pattern', settings: { zoom: 2, scaleOnZoom: false, dashLength: 7.5, dashGap: 3.25 } },
  { name: 'Gradient overlap', settings: { endpointColors: true, opacity: 0.35, reverse: true } },
  { name: 'Hidden', settings: { opacity: 0 } },
]
export type PatternWitness = { x: number; y: number; id: number; rgba: number[]; idealStraightPhase?: number; idealStraightRemainder?: number }
export type PatternRow = {
  scene: string; pattern: Pattern; profile: string; settings: Settings;
  production: Comparison; candidate: Comparison;
  preservation: Record<'webgl' | 'webgpu', ReturnType<typeof compareColors>>;
  sources: { webgl: number; webgpu: number }; invisibleSamples: Record<'webgl' | 'webgpu', PatternWitness[]>; passed: boolean;
}
export async function replayPatterns<S extends Settings, T extends RgbaSnapshot> (options: {
  scenes: Record<string, Scene>; defaults: S;
  render(lane: 'webgl' | 'webgpu', scene: Scene, settings: S, candidate: boolean): Promise<T>;
  compare(a: T, b: T, scene: Scene, settings: S): Promise<Comparison>;
}): Promise<PatternRow[]> {
  const rows: PatternRow[] = []
  for (const [name, original] of Object.entries(options.scenes)) {
    for (const pattern of ['dashed', 'dotted'] as const) {
      for (const profile of PATTERN_PROFILES) {
        const settings = { ...options.defaults, ...profile.settings, pattern }
        const scene = settings.endpointColors ? gradientScene(original, 'endpoints') : original
        const control = { webgl: await options.render('webgl', scene, settings, false), webgpu: await options.render('webgpu', scene, settings, false) }
        const candidate = { webgl: await options.render('webgl', scene, settings, true), webgpu: await options.render('webgpu', scene, settings, true) }
        const production = await options.compare(control.webgl, control.webgpu, scene, settings)
        const comparison = await options.compare(candidate.webgl, candidate.webgpu, scene, settings)
        const preservation = {
          webgl: compareColors(control.webgl.color, candidate.webgl.color),
          webgpu: compareColors(control.webgpu.color, candidate.webgpu.color),
        }
        const sources = { webgl: 0, webgpu: 0 }
        const invisibleSamples: PatternRow['invisibleSamples'] = { webgl: [], webgpu: [] }
        for (const lane of ['webgl', 'webgpu'] as const) {
          const image = candidate[lane]
          for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
              const id = pick(image, x, y); const offset = (y * image.width + x) * 4
              if (id === null || image.color[offset + 3] !== 0 || invisibleSamples[lane].length >= 16) continue
              const witness: PatternWitness = { x, y, id, rgba: Array.from(image.color.slice(offset, offset + 4)) }
              invisibleSamples[lane].push(witness)
              // Chord projection describes only straight dashes, not curved t or dot periods.
              const link = scene.links[id - settings.indexOffset]
              if (!link || 'segments' in settings || pattern !== 'dashed') continue
              const a = scene.points[link.source]; const b = scene.points[link.target]
              const ax = ((a.x - 256) * settings.zoom + 256) * settings.ratio
              const ay = ((a.y - 160) * settings.zoom + 160) * settings.ratio
              const dx = (b.x - a.x) * settings.zoom * settings.ratio; const dy = (b.y - a.y) * settings.zoom * settings.ratio
              const phase = ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / Math.hypot(dx, dy) /
                (settings.ratio * (settings.scaleOnZoom ? settings.zoom : 1))
              const period = (settings.dashLength ?? 5) + (settings.dashGap ?? 5)
              witness.idealStraightPhase = phase
              witness.idealStraightRemainder = phase - Math.floor(phase / period) * period
            }
          }
          for (let id = 0; id < scene.links.length; id++) {
            const isolated = { ...scene, links: scene.links.map((l, i) => i === id ? l : { ...l, width: 0 }) }
            const source = await options.render(lane, isolated, settings, true)
            for (let y = 0; y < image.height; y++) {
              for (let x = 0; x < image.width; x++) {
                if (pick(image, x, y) === id + settings.indexOffset && source.color[(y * image.width + x) * 4 + 3] === 0) sources[lane]++
              }
            }
          }
        }
        rows.push({
          scene: name,
          pattern,
          profile: profile.name,
          settings,
          production,
          candidate: comparison,
          preservation,
          sources,
          invisibleSamples,
          passed: comparison.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 &&
            sources.webgl === 0 && sources.webgpu === 0,
        })
      }
    }
  }
  return rows
}
