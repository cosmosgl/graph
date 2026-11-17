import { expect, it } from 'vitest'
import { createOracle } from '../combined-layout/reference'
import { forceSettings } from '../combined-layout/production-settings'
import { compareArray } from '../many-body/reference'
import { writeArtifact } from '../../testing/artifacts'
import { validateFrame } from './validation'
import { interactionCheck } from './evaluate'
import { createIntegrated, nextFrame, type FrameTrace } from './runtime'

it('renders 1,024 shared positions, picks/drags before scaling, preserves state and destroys safely', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 600
  document.body.append(canvas)
  const r = await createIntegrated(canvas)
  try {
    r.resize(960, 600, devicePixelRatio)
    expect(r.backend.positionSource!().device.type).toBe('webgpu')
    const identity = r.backend.resourceIdentity!()
    const oracle = createOracle(r.data.graph, r.data.input, 'production', { ...forceSettings('reference', 1024), center: 0.1 })
    const expected = oracle.tick(r.data.input.points, 1, 0)
    const trace: FrameTrace = { encodeSimulationMs: -1, encodeDrawMs: -1, completionWaitMs: -1 }
    await r.frame(true, trace)
    expect(Object.values(trace).every(v => Number.isFinite(v) && v >= 0)).toBe(true)
    expect(r.tick).toBe(1)
    expect(compareArray((await r.backend.read()).positions, expected).valid).toBe(true)
    const checks = await interactionCheck(r); await writeArtifact('integrated-preflight', { info: r.info, checks })
    expect(checks.exactIds).toBe(true); expect(checks.dragPinned).toBe(true)
    expect(checks.pause && checks.resume && checks.resize).toBe(true)
    const pixels = await validateFrame(r); await writeArtifact('integrated-pixels', pixels)
    expect(pixels.finite).toBe(true); expect(pixels.paintedSamples).toBeGreaterThan(0)
    expect(pixels.interiorIdFailures).toBe(0); expect(pixels.interiorColorFailures).toBe(0); expect(pixels.invisiblePicks).toBe(0)
    for (const [kind, count] of [['communities', 1024], ['star', 8192], ['karate', 34]] as const) {
      await r.replace(kind, count); expect(r.tick).toBe(0); expect(r.backend.positionSource!().count).toBe(count)
      expect(r.backend.positionSource!().device.id).toBe(identity.device)
      await r.step(); expect(Array.from((await r.backend.read()).positions).every(Number.isFinite)).toBe(true)
    }
    r.resume(); await nextFrame(); await nextFrame(); r.pause(); const tick = r.tick
    await nextFrame(); await nextFrame(); expect(r.tick).toBe(tick)
    const latePick = r.pick(0, 0); r.destroy(); await latePick.catch(() => null)
    r.destroy(); expect(r.destroyed).toBe(true); expect(() => r.resume()).toThrow('destroyed')
  } finally { r.destroy(); canvas.remove() }
}, 120000)

it('keeps zero-opacity foreground unpickable, preserves 0.35/1 colors and isolates circle boundaries', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
  const r = await createIntegrated(canvas, 'chain', 4)
  try {
    r.resize(64, 64, 1); r.renderer.camera.zoom = 1
    const positions = new Float32Array([0, 0, 1, 0, 0, 0, 1, 0, 20, 20, 0, 1, -20, -20, 0, 1])
    r.backend.setPositions(positions)
    r.backend.replaceLinks!({ ...r.data.graph, links: new Float32Array(), weights: new Float32Array() })
    r.renderer.replace({ ...r.data.graph, links: new Float32Array() })
    for (const alpha of [0, 0.02, 0.35, 1]) {
      r.renderer.selected = -1; r.renderer.setStyle(0, [0.2, 0.4, 0.8, 1], 12)
      r.renderer.setStyle(1, [0.8, 0.2, 0.3, alpha], 12)
      const snapshot = await r.renderer.snapshot()
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const o = (y * 64 + x) * 4; const distance = Math.hypot(x + 0.5 - 32, y + 0.5 - 32)
          const id = snapshot.ids[o] + snapshot.ids[o + 1] * 256 + snapshot.ids[o + 2] * 65536
          if (id) expect(snapshot.color[o + 3]).toBeGreaterThan(0)
          if (Math.abs(distance - 6) > 1) {
            expect(id).toBe(distance < 6 ? alpha ? 2 : 1 : 0)
            if (distance < 5) {
              [0.8 * alpha + 0.2 * (1 - alpha), 0.2 * alpha + 0.4 * (1 - alpha), 0.3 * alpha + 0.8 * (1 - alpha)].forEach((v, c) => {
                expect(Math.abs(snapshot.color[o + c] - Math.round(v * 255))).toBeLessThanOrEqual(2)
              })
            }
          }
        }
      }
      expect(await r.renderer.pick(32, 32)).toBe(alpha ? 1 : 0)
    }
    expect(() => r.renderer.setStyle(1, [1, 1, 1, 0.001], 6)).toThrow('Unsupported')
  } finally { r.destroy() }
})

it('keeps a thin solid link visible rather than excluding its entire footprint as a boundary', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
  const r = await createIntegrated(canvas, 'chain', 4)
  try {
    r.resize(64, 64, 1); r.renderer.camera.zoom = 1
    r.backend.setPositions(new Float32Array([-20, 0, 1, 0, 20, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1]))
    r.renderer.replace({ ...r.data.graph, links: new Float32Array([0, 1]) })
    for (let i = 0; i < 4; i++) r.renderer.setStyle(i, [0, 0, 0, 0], 0)
    r.renderer.setLinkStyle([127 / 255, 137 / 255, 152 / 255, 0.45], 1.25)
    const snapshot = await r.renderer.snapshot()
    // Both pixel-center rows cross the 1.25-pixel rectangle; endpoint circles are hidden.
    for (let x = 13; x < 51; x++) {
      for (const y of [31, 32]) {
        const offset = (y * 64 + x) * 4
        expect(snapshot.color[offset + 3]).toBeGreaterThan(0)
        expect(snapshot.ids[offset] + snapshot.ids[offset + 1] + snapshot.ids[offset + 2]).toBe(0)
        ;[127, 137, 152, 255].forEach((v, c) => {
          expect(Math.abs(snapshot.color[offset + c] - Math.round(v * 0.45))).toBeLessThanOrEqual(2)
        })
      }
    }
    for (const [width, alpha] of [[0, 1], [2.75, 0], [2.75, 1]]) {
      r.renderer.setLinkStyle([0.8, 0.1, 0.3, alpha], width)
      const styled = await r.renderer.snapshot(); const offset = (32 * 64 + 32) * 4
      expect(styled.color[offset + 3] > 0).toBe(width > 0 && alpha > 0)
      if (width > 0 && alpha > 0) expect(Math.abs(styled.color[offset] - 204)).toBeLessThanOrEqual(2)
    }
  } finally { r.destroy() }
})
