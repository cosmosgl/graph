import type { evaluate } from '../integrated-webgpu/evaluate'
import type { validateFrame } from '../integrated-webgpu/validation'
export type Assessment = Awaited<ReturnType<typeof evaluate>>
export type Pixels = Awaited<ReturnType<typeof validateFrame>>
export type Check = { name: string; pass: boolean; detail: string }
export function pixelCheck (p: Pixels): Check {
  return {
    name: 'Sampled CPU pixels',
    pass: p.finite && p.paintedSamples > 0 && p.interiorIdFailures === 0 &&
    p.interiorColorFailures === 0 && p.invisiblePicks === 0,
    detail: `${p.samples} samples · ${p.interiorIdFailures} wrong IDs · ${p.interiorColorFailures} color errors · ${p.invisiblePicks} invisible picks`,
  }
}
export function assessmentChecks (a: Pick<Assessment, 'frames' | 'within33' | 'frameCount' | 'interactions' | 'validation'>): Check[] {
  const i = a.interactions
  return [
    {
      name: 'Complete frame intervals',
      pass: a.frameCount === 300 && a.within33 >= 0.95,
      detail: `${a.frameCount} intervals · p95 ${a.frames.p95.toFixed(1)} ms · ${(a.within33 * 100).toFixed(1)}% within 33 ms`,
    },
    {
      name: 'Picking and drag feedback',
      pass: Math.max(i.pick.max, i.activePick.max, i.drag.max) <= 50,
      detail: `Maximum: paused pick ${i.pick.max.toFixed(1)} ms · running pick ${i.activePick.max.toFixed(1)} ms · drag ${i.drag.max.toFixed(1)} ms`,
    },
    {
      name: 'Interaction and lifecycle',
      pass: i.exactIds && i.dragPinned && i.pause && i.resume && i.resize,
      detail: `Exact IDs/camera ${i.exactIds} · drag pin ${i.dragPinned} · pause ${i.pause} · resume ${i.resume} · resize ${i.resize}`,
    },
    pixelCheck(a.validation),
  ]
}
export const protocol = 'Karate Club: 34 members, 78 weighted links, seed 29471, default corrected core forces, 5,000-tick cooling. ' +
  'Available CSS width at a 16:9 aspect ratio, captured on load at actual DPR; dimensions are exported. ' +
  'Reset to uniform six-pixel circles. 60 warmup ticks, Fit, 300 complete evolving intervals with one GPU completion in flight. ' +
  'No validation readbacks inside the frame window. Then the existing 20 paused picks, 20 running picks on a temporary pinned target, ' +
  '20 drag moves, pan/zoom, pause/resume, resize and sampled CPU pixel checks. ' +
  'Finally use native input to pick/drag, locate a member, follow a neighbor, change point sizes and reset the graph. ' +
  'Frame gate: ≥95% within 33 ms; measured input feedback ≤50 ms; exact IDs, no invisible picks; unchanged geometric boundary and 2/255 color rules.'
