import { expect, it, vi } from 'vitest'
import '../../app/styles.css'
import { writeArtifact } from '../../testing/artifacts'
import { createView } from './view'
import type { PaintComparison } from './evaluate'

type PaintRow = PaintComparison & { action: string; style: 'A' | 'B'; scene: string; pointCount: number; linkCount: number }
type Capture = {
  gl: string;
  gpu: string;
  viewport: number[];
  records: Array<PaintRow | { action: string; error?: string }>;
}

async function capturePaint (actions: string[], artifact: string): Promise<PaintRow[]> {
  expect(document.visibilityState).toBe('visible')
  expect(navigator.userAgent).not.toContain('HeadlessChrome')
  const base = document.createElement('base'); base.href = '/'; document.head.prepend(base)
  const host = document.createElement('div'); host.style.width = '960px'; document.body.append(host)
  let view: Awaited<ReturnType<typeof createView>> | undefined
  try {
    view = await createView(host)
    const button = (action: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!
    const act = async (action: string): Promise<void> => {
      button(action).click()
      await vi.waitFor(() => expect(button(action).disabled).toBe(false), { timeout: 30000 })
    }
    for (const style of ['A', 'B']) {
      if (style === 'B') await act('style')
      for (const action of actions) await act(action)
    }
    const blob = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:paint-layers-test')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await act('export')
    expect(blob).toHaveBeenCalledOnce()
    const result = JSON.parse(await (blob.mock.calls[0][0] as Blob).text()) as Capture
    await writeArtifact(artifact, result)
    expect(result.gl).toMatch(/Apple M3/)
    expect(result.gpu).toContain('"fallback":false')
    expect(result.viewport).toEqual([960, 320, 2])
    expect(result.records.filter(r => 'error' in r && r.error)).toEqual([])
    const rows = result.records.filter((r): r is PaintRow => r.action === 'same-geometry-paint' && 'style' in r)
    expect(rows.map(r => r.style)).toEqual(['A', 'A', 'B', 'B'])
    return rows
  } finally {
    vi.restoreAllMocks(); view?.destroy(); host.remove(); base.remove()
  }
}

it.skipIf(import.meta.env.VITE_LAB_PAINT_LAYERS !== '1')('localizes frozen viewer color differences on both paint styles', async () => {
  const [fullA, layersA, fullB, layersB] = await capturePaint(['paint', 'paint-layers'], 'viewer-paint-layers')
  for (const [full, attributed] of [[fullA, layersA], [fullB, layersB]]) {
    expect(full.nonempty).toBe(true)
    const { colorAttribution, ...replay } = attributed
    expect(replay).toEqual(full)
    expect(colorAttribution).toBeDefined()
    const sum = Object.values(colorAttribution!).reduce((total, item) => total + item.count, 0)
    expect(sum).toBe(full.interiorColorFailures)
  }
}, 120000)

it.skipIf(import.meta.env.VITE_LAB_PAINT_LINK_SMOOTHING !== '1')('compares the one-pixel link ramp against the original paint control', async () => {
  const [hardA, rampA, hardB, rampB] = await capturePaint(['paint-layers', 'paint-link-smoothing'], 'viewer-link-smoothing')
  for (const [hard, ramp] of [[hardA, rampA], [hardB, rampB]]) {
    expect(hard.smoothLinks).toBeUndefined()
    expect(ramp.smoothLinks).toBe(true)
    expect(hard.nonempty && ramp.nonempty).toBe(true)
    expect(hard.scene).toBe('karate')
    expect(hard.pointCount).toBe(34)
    expect(hard.linkCount).toBe(78)
    expect(ramp.geometry).toEqual(hard.geometry)
    expect(ramp.camera).toEqual(hard.camera)
    expect(ramp.samples).toBe(hard.samples)
    expect(ramp.boundarySamples).toBe(hard.boundarySamples)
    expect(ramp.interiorIdFailures).toBe(hard.interiorIdFailures)
    expect(ramp.candidateInvisiblePicks).toBe(hard.candidateInvisiblePicks)
    expect(ramp.boundaryColorFailures).not.toBe(hard.boundaryColorFailures)
  }
}, 120000)
