import type { Device } from '@luma.gl/core'
import type { RgbaSnapshot } from '../../gpu/rgba-readback'
import { type Scene, type Settings } from '../curved-links/data'
import { median } from '../weighted-links/timing'
import { createRibbonResources, type Lane, type Measurement } from './backend'
import { changedPixels, firstDifference } from './data'
export const TRIALS = ['vertex', 'control', 'rebuild', 'reuse'] as const
export type Trial = typeof TRIALS[number]
export type TrialResult = { trial: Trial; samples: Measurement[]; wallSamples: Measurement[]; gpuMs: number | null; wallMs: number }
export function summarize (trial: Trial, samples: Measurement[], wallSamples: Measurement[]): TrialResult {
  return {
    trial,
    samples,
    wallSamples,
    gpuMs: samples.every(s => s.gpuMs !== null) ? median(samples.map(s => s.gpuMs!)) : null,
    wallMs: median(wallSamples.map(s => s.wallMs)),
  }
}
export async function runStudy (device: Device, scene: Scene, settings: Settings, picking: boolean,
  cancelled: () => boolean, progress: (message: string) => void, distribution = 'custom'): Promise<Report> {
  const resources = createRibbonResources(device, scene, settings)
  const start = new Date().toISOString()
  const check = (): void => { if (cancelled()) throw new Error('Run cancelled; partial timings are not a completed comparison') }
  try {
    const baseline = await resources.snapshot('vertex'); check()
    const candidate = await resources.snapshot('rebuild'); check()
    const reuse = await resources.snapshot('reuse'); check()
    const validation = {
      colorPixels: changedPixels(baseline.color, candidate.color),
      idPixels: changedPixels(baseline.ids, candidate.ids),
      reuseColorPixels: changedPixels(candidate.color, reuse.color),
      reuseIdPixels: changedPixels(candidate.ids, reuse.ids),
      firstColorDifference: firstDifference(baseline.color, candidate.color, baseline.width),
      firstIdDifference: firstDifference(baseline.ids, candidate.ids, baseline.width),
      visiblePixels: baseline.color.filter((v, i) => i % 4 === 3 && v > 0).length,
    }
    const samples = Object.fromEntries(TRIALS.map(t => [t, [] as Measurement[]])) as Record<Trial, Measurement[]>
    const wallSamples = Object.fromEntries(TRIALS.map(t => [t, [] as Measurement[]])) as Record<Trial, Measurement[]>
    for (const lane of ['vertex', 'rebuild', 'reuse'] as Lane[]) { await resources.measure(lane, picking, 4, false); check() }
    // Rotate the order, including a duplicate baseline to expose drift/noise.
    for (let round = 0; round < 8; round++) {
      for (let offset = 0; offset < TRIALS.length; offset++) {
        check(); const trial = TRIALS[(round + offset) % TRIALS.length]; const lane = trial === 'control' ? 'vertex' : trial
        progress(`Trial ${round + 1}/8 · ${trial}`)
        samples[trial].push(await resources.measure(lane, picking))
        check(); wallSamples[trial].push(await resources.measure(lane, picking, 8, false))
      }
    }
    check()
    return {
      schemaVersion: 1,
      experiment: 'ribbon-generation',
      api: 'luma.gl 10.0.0-alpha.15',
      start,
      finish: new Date().toISOString(),
      browser: navigator.userAgent,
      device: device.info,
      settings,
      picking,
      linkCount: scene.links.length,
      distribution,
      seed: 123456789,
      sampleBytes: resources.sampleBytes,
      validation,
      results: TRIALS.map(trial => summarize(trial, samples[trial], wallSamples[trial])),
      baseline,
      candidate,
    }
  } finally { resources.destroy() }
}
export type Report = {
  schemaVersion: number; experiment: string; api: string; start: string; finish: string; browser: string;
  device: Device['info']; settings: Settings; picking: boolean; linkCount: number; sampleBytes: number;
  distribution: string; seed: number;
  validation: { colorPixels: number; idPixels: number; reuseColorPixels: number; reuseIdPixels: number; visiblePixels: number;
    firstColorDifference: ReturnType<typeof firstDifference>; firstIdDifference: ReturnType<typeof firstDifference>;
  };
  results: TrialResult[]; baseline: RgbaSnapshot; candidate: RgbaSnapshot;
}
export function assessment (report: Report): string {
  if (report.validation.colorPixels || report.validation.idPixels || report.validation.reuseColorPixels || report.validation.reuseIdPixels || !report.validation.visiblePixels) {
    return 'Rendering gate failed. Cost is diagnostic; investigate the mismatch before advancing.'
  }
  if (report.device.fallback) return 'Software adapter: execution evidence only; native cost remains unmeasured.'
  const [base, control, rebuild, reuse] = report.results.map(r => r.gpuMs)
  if (base === null || control === null || rebuild === null || reuse === null || base <= 0) return 'GPU timing unavailable or below resolution. No speed conclusion.'
  const noise = Math.abs(control / base - 1)
  if (noise > 0.1) return 'Duplicate baseline differs by more than 10%. Repeat before interpreting savings.'
  const threshold = Math.max(0.1, noise * 2)
  const gains = [rebuild, reuse].map(ms => 1 - ms / base)
  const walls = report.results.map(r => r.wallMs)
  if (gains[0] > threshold && walls[2] <= walls[0] * 1.1) return 'Rebuild is a promising follow-up on this workload. Repeat across sizes/devices; no production approval.'
  if (gains[1] > threshold && walls[3] <= walls[0] * 1.1) return 'Only static reuse clears this screening threshold. Investigate settled layouts before moving-frame adoption.'
  return 'No convincing end-to-end saving in this run. Keep vertex generation; inspect compute, bandwidth and fill cost before expanding.'
}
