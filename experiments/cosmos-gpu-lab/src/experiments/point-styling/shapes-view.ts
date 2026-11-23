import type { ExperimentInstance } from '../../runtime/experiment'
import { createLiveChecks } from '../../runtime/live-checks'
import { mountPixelInspector } from '../../runtime/pixel-inspector'
import type { Backend, Snapshot } from './backend'
import { fixture, HEIGHT, WIDTH } from './data'
import { compareSnapshots, evaluatePracticalBoundary, type Comparison, type PracticalBoundary } from './reference'
import { shapeChoice, shapeControls, shapeSettings } from './shape-controls'
import { runShapeTrial, shapeGroups, type ShapeScene } from './shapes-suite'
import { createStylingWebGL, type StylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

const lanes = ['webgl', 'webgpu'] as const
type Lane = typeof lanes[number]
const names = { webgl: 'Cosmos WebGL', webgpu: 'WebGPU' }
const legends: Record<ShapeScene, string> = {
  shapes: 'The top row shows the eight filled shapes. The bottom row adds an inset stroke.',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Matches the scene ID.
  'edge-cases': 'Above are defaults, hidden points and a size cap. Below are a half-pixel circle, a capped stroke and a translucent diamond.',
  fractional: 'These circles have fractional centers and diameters from 0.25 to 42.5 CSS pixels at 1× zoom.',
}

function previewResult (strict: Comparison, edge: PracticalBoundary): string {
  const invisible = strict.firstWebgpuInvisiblePick ?? strict.firstWebglInvisiblePick
  if (invisible) {
    const renderer = strict.firstWebgpuInvisiblePick ? 'WebGPU' : 'WebGL'
    return `${renderer} picks point ${invisible.point} at (${invisible.x}, ${invisible.y}), where the pixel is fully transparent.`
  }
  if (edge.vanishedPointIds.length) return `Thin point ${edge.vanishedPointIds[0]} disappears in WebGPU.`
  if (strict.valid) {
    if (!strict.maxChannelError) return 'Both previews draw identical pixels and pick the same points.'
    return `Both previews pick the same points. The largest difference in color or opacity is ${strict.maxChannelError} on a 0–255 scale.`
  }

  let difference: string
  if (strict.firstIdMismatch) {
    const { x, y, webgl, webgpu } = strict.firstIdMismatch
    const target = (id: number | null): string => id === null ? 'nothing' : `point ${id}`
    difference = `At pixel (${x}, ${y}), WebGL picks ${target(webgl)} and WebGPU picks ${target(webgpu)}.`
  } else if (strict.firstReferenceMismatch) {
    const { x, y } = strict.firstReferenceMismatch
    difference = `At pixel (${x}, ${y}), both previews return the same pick. The shape outline predicts a different result.`
  } else {
    const { x, y } = strict.firstColorMismatch!
    difference = `Picking matches everywhere. At pixel (${x}, ${y}), color or opacity differs by more than 2 levels out of 255.`
  }
  if (edge.valid) return `${difference} Every mismatch is within one device pixel of a shape outline.`
  if (edge.wrongObjectPixels) return `${difference} Picking at an edge disagrees with the outline of the point involved.`
  return `${difference} Some mismatches are more than one device pixel from a shape outline.`
}

export async function createShapesView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<section id="run-run" class="shape-preview">
      <div class="choice-controls shape-controls">${shapeControls('scene')}</div>
      <p class="visually-hidden" data-inspect-feedback aria-live="polite"></p>
      <div class="backend-panels styling-panels">${lanes.map(lane => `<div class="backend-panel">
        <strong data-heading="${lane}">${names[lane]}</strong>
        <div class="styling-viewport"><canvas width="${WIDTH}" height="${HEIGHT}" data-canvas="${lane}" tabindex="0"
          role="button" aria-pressed="false" aria-label="Pin pixel in ${names[lane]} preview" aria-describedby="shape-scene shape-pixel-help"></canvas>
          <span class="styling-cursor" data-cursor="${lane}" hidden></span></div>
        <p data-pick="${lane}" class="styling-pick"></p><p data-error="${lane}" class="canvas-error" hidden></p></div>`).join('')}</div>
      <p role="status" data-preview-status>Preparing previews…</p>
      <p id="shape-scene" class="case-meta" hidden></p>
      <p id="shape-pixel-help" class="case-meta">Arrow keys move one pixel. Enter or Space pins or releases it.</p>
    </section>
    <div id="run-configuration" class="choice-controls shape-controls shape-settings">${shapeControls('settings')}</div>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const buttons = host.querySelectorAll<HTMLButtonElement>('[data-control] button')
  const sizeOnZoom = el('[data-control="scale"]')
  const status = el('[data-preview-status]')
  const backends: { webgl?: StylingWebGL; webgpu?: Backend } = {}
  const snapshots: Partial<Record<Lane, Snapshot>> = {}
  let runtimeLabel: string | undefined
  let checks: ReturnType<typeof createLiveChecks> | undefined
  let disposed = false
  let drawing = false
  let pending = Promise.resolve()

  function release (): void {
    try { backends.webgl?.destroy() } finally { backends.webgpu?.destroy() }
  }

  // Each check uses its own fixed scene offscreen. Preview edits can run between checks
  // after their readbacks finish, so changing the preview can leave the suite running.
  function enqueue<T> (work: () => Promise<T>): Promise<T> {
    const result = pending.then(() => {
      if (disposed) throw new Error('Point shapes view closed.')
      return work()
    })
    pending = result.then(() => {}, () => {})
    return result
  }
  const inspector = mountPixelInspector(host, true, lane => snapshots[lane], () => !disposed && !drawing)
  const unavailable = 'Live comparison requires both WebGL and WebGPU.'
  function failPanel (lane: Lane, error: unknown): void {
    const backend = backends[lane]
    delete backends[lane]
    delete snapshots[lane]
    try { backend?.destroy() } finally {
      el(`[data-canvas="${lane}"]`).parentElement!.hidden = true
      const message = el(`[data-error="${lane}"]`)
      message.hidden = false
      message.textContent = `${names[lane]} unavailable. ${error instanceof Error ? error.message : String(error)}`
      checks?.disable(unavailable)
    }
  }

  async function redraw (): Promise<void> {
    drawing = true
    inspector.reset()
    for (const button of buttons) button.disabled = true
    status.textContent = 'Comparing pixels…'
    try {
      await enqueue(async () => {
        const scene = shapeChoice(host, 'fixture') as ShapeScene
        const variant = shapeChoice(host, 'renderer') as 'explicit' | 'production'
        const settings = shapeSettings(host)
        const points = fixture(scene)
        const legend = el('#shape-scene')
        legend.textContent = legends[scene]
        legend.hidden = scene === 'shapes'
        el('[data-heading="webgpu"]').textContent = `WebGPU · ${variant === 'explicit' ? 'closed' : 'half-open'} bounds`
        for (const lane of lanes) {
          const backend = backends[lane]
          if (!backend) continue
          try { snapshots[lane] = await backend.render(points, settings, false, lane === 'webgl' ? 'production' : variant) } catch (error) {
            failPanel(lane, error)
          }
        }
        const { webgl, webgpu } = snapshots
        if (!webgl || !webgpu) { status.textContent = unavailable; return }
        const strict = compareSnapshots(webgl, webgpu, points, settings)
        const practical = evaluatePracticalBoundary(webgl, webgpu, points, settings, strict)
        status.textContent = previewResult(strict, practical)
      })
    } catch (error) {
      if (!disposed) status.textContent = `Comparison failed. ${String(error)}`
    } finally {
      drawing = false
      if (!disposed) {
        inspector.restore()
        const atUnitZoom = shapeChoice(host, 'zoom') === '1'
        sizeOnZoom.title = atUnitZoom ? 'Change zoom to compare point sizes.' : ''
        for (const button of buttons) {
          button.disabled = (!backends.webgl && !backends.webgpu) || (atUnitZoom && sizeOnZoom.contains(button))
        }
      }
    }
  }

  try {
    for (const lane of lanes) {
      const canvas = el<HTMLCanvasElement>(`[data-canvas="${lane}"]`)
      try {
        if (lane === 'webgl') backends.webgl = await createStylingWebGL(canvas)
        else {
          const gpu = await createStylingWebGPU(canvas)
          backends.webgpu = gpu
          const { renderer, vendor, gpuArchitecture, fallback } = gpu.adapter
          const device = renderer || [vendor, gpuArchitecture].filter(Boolean).join(' ') || 'unidentified adapter'
          runtimeLabel = `WebGPU: ${device}${fallback ? ' (fallback)' : ''}`
        }
      } catch (error) { failPanel(lane, error) }
    }
    await redraw()
    checks = createLiveChecks({
      sectionId: 'doc-automated-cases',
      recordedEnvironment: 'Chrome 157 · M3',
      recordedLabel: 'Recorded (M3)',
      ruleNote: 'Strict checks require exact picking IDs and CPU masks, with colors within 2/255 of WebGL. ' +
        'For tiny and fractional circles, color and ID differences may occur within one device pixel of the outline. ' +
        'Closed bounds must still match the CPU mask everywhere, keep thin points visible and never pick an invisible pixel.',
      groups: shapeGroups,
      runtimeLabel,
      unavailableReason: backends.webgl && backends.webgpu ? undefined : unavailable,
      runCheck: id => enqueue(async () => {
        if (!backends.webgl || !backends.webgpu) throw new Error(unavailable)
        return runShapeTrial(id, backends.webgl, backends.webgpu)
      }),
    })
    for (const button of buttons) {
      button.onclick = (): void => {
        if (drawing || disposed || button.getAttribute('aria-pressed') === 'true') return
        for (const option of button.parentElement!.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === button))
        redraw()
      }
    }
    return {
      pageEndSection: checks.element,
      pause: checks.stop,
      destroy (): void {
        disposed = true
        checks?.destroy()
        pending.then(release).catch(error => console.error('Point shape cleanup failed', error))
      },
    }
  } catch (error) { checks?.destroy(); release(); throw error }
}
