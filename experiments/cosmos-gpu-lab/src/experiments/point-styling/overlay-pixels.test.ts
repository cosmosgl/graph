import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { compareColors, compareSnapshotsAsync } from './reference'
import { effectsCpuColors } from './effects-reference'
import { effectScenario, EFFECTS_FIXTURES, EFFECTS_PROFILES, EFFECTS_VIEWS } from './effects-fixtures'

it('compares pixel-distance overlays with the retained control and unchanged CPU color budget', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const rows = []
    for (const name of EFFECTS_FIXTURES) {
      for (const [profile, label] of EFFECTS_PROFILES.entries()) {
        for (const view of EFFECTS_VIEWS) {
          const { points, settings } = effectScenario(name, profile, view.settings)
          const config = { ...settings, overlayArithmetic: 'pixels' as const }
          const snapshots = []; const backends = []
          for (const backend of [gl, gpu]) {
            const control = await backend.render(points, settings, false, 'eligibility', false)
            const candidate = await backend.render(points, config, false, 'eligibility', false)
            const explicit = await backend.render(points, config, false, 'explicit', false)
            const noOverlays = await backend.render(points, { ...settings, hovered: [], focused: undefined }, false, 'eligibility', false)
            backends.push({
              control: effectsCpuColors(control, points, settings),
              candidate: effectsCpuColors(candidate, points, config),
              noOverlays: effectsCpuColors(noOverlays, points, { ...settings, hovered: [], focused: undefined }),
              controlDifference: compareColors(control, candidate),
              pickOnlyColors: compareColors(explicit, candidate),
              overlayIdsUnchanged: candidate.ids.every((v, i) => v === noOverlays.ids[i]),
              idsUnchanged: candidate.ids.every((v, i) => v === control.ids[i]),
            })
            snapshots.push(candidate)
          }
          rows.push({
            name,
            profile: label.name,
            view: view.name,
            backends,
            comparison: await compareSnapshotsAsync(snapshots[0], snapshots[1], points, config),
          })
        }
      }
    }
    await writeArtifact('pixel-distance-overlays', { browser: navigator.userAgent, device: { webgl: gl.info, webgpu: gpu.info }, rows })
    const colorFailures = rows.filter(r => r.backends.some(b => b.candidate.budgetFailures))
    expect(colorFailures, JSON.stringify(colorFailures)).toEqual([])
    expect(rows.every(r => r.backends.every(b => b.idsUnchanged && b.overlayIdsUnchanged && b.pickOnlyColors.changedPixels === 0))).toBe(true)
    // These are the same accepted scene/view masks as the retained ring test.
    const maskFailures = rows.filter(r => r.name !== 'shapes' && r.view === EFFECTS_VIEWS[0].name && !r.comparison.valid)
    expect(maskFailures, JSON.stringify(maskFailures)).toEqual([])
  } finally { gpu?.destroy(); gl.destroy() }
}, 300000)
