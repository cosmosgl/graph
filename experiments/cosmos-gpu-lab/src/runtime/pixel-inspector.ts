import { pick, type RgbaSnapshot } from '../gpu/rgba-readback'

type Lane = 'webgl' | 'webgpu'
type Position = { u: number; v: number }

export function mountPixelInspector (
  host: HTMLElement, pinnable: boolean, snapshotFor: (lane: Lane) => RgbaSnapshot | undefined, ready: () => boolean,
  objectName: 'point' | 'link' = 'point'
): { reset(): void; restore(): void } {
  const panels = (['webgl', 'webgpu'] as const).map(lane => ({
    lane,
    name: lane === 'webgl' ? 'WebGL' : 'WebGPU',
    viewport: host.querySelector<HTMLCanvasElement>(`[data-canvas="${lane}"]`)!.parentElement!,
    get canvas (): HTMLCanvasElement { return this.viewport.querySelector('canvas')! },
    cursor: host.querySelector<HTMLElement>(`[data-cursor="${lane}"]`)!,
    readout: host.querySelector<HTMLElement>(`[data-pick="${lane}"]`)!,
  }))
  const feedback = host.querySelector<HTMLElement>('[data-inspect-feedback]')!
  const center = { u: 0.5, v: 0.5 }
  let position: Position | undefined
  let pinned = false

  function inspect (at: Position, announce = false): void {
    position = at
    const descriptions: string[] = []
    for (const { lane, name, cursor, readout } of panels) {
      const snapshot = snapshotFor(lane)
      if (!snapshot) continue
      const x = Math.min(snapshot.width - 1, Math.max(0, Math.floor(at.u * snapshot.width)))
      const y = Math.min(snapshot.height - 1, Math.max(0, Math.floor(at.v * snapshot.height)))
      const id = pick(snapshot, x, y)
      const alpha = snapshot.color[(y * snapshot.width + x) * 4 + 3]
      cursor.hidden = false
      cursor.style.left = `${(x + 0.5) / snapshot.width * 100}%`
      cursor.style.top = `${(y + 0.5) / snapshot.height * 100}%`
      const pixel = `${pinned ? 'Pinned pixel' : 'Pixel'} (${x}, ${y})`
      const sample = `${id === null ? 'background' : `${objectName} ${id}`} · rendered alpha ${alpha}/255`
      readout.textContent = `${pixel} · ${sample}`
      if (announce) {
        if (!descriptions.length) descriptions.push(pixel)
        descriptions.push(`${name} ${sample}`)
      }
    }
    if (announce) feedback.textContent = descriptions.join(' · ')
  }

  function togglePin (at: Position): void {
    pinned = !pinned
    for (const { canvas } of panels) canvas.setAttribute('aria-pressed', String(pinned))
    inspect(at, true)
  }

  for (const panel of panels) {
    const { lane, viewport } = panel
    const pointerPosition = (event: MouseEvent): Position | undefined => {
      const box = panel.canvas.getBoundingClientRect()
      if (!box.width || !box.height) return undefined
      return { u: (event.clientX - box.left) / box.width, v: (event.clientY - box.top) / box.height }
    }
    viewport.addEventListener('pointermove', event => {
      if (pinned || !ready() || !snapshotFor(lane)) return
      const at = pointerPosition(event)
      if (at) inspect(at)
    })
    if (!pinnable) continue
    viewport.addEventListener('click', event => {
      if (!ready() || !snapshotFor(lane)) return
      const at = event.detail ? pointerPosition(event) : position ?? center
      if (at) togglePin(at)
    })
    viewport.addEventListener('focusin', () => {
      if (panel.canvas.matches(':focus-visible') && ready() && snapshotFor(lane)) inspect(position ?? center, true)
    })
    viewport.addEventListener('keydown', event => {
      const snapshot = snapshotFor(lane)
      if (!ready() || !snapshot) return
      const at = position ?? center
      if (event.key === 'Enter' || event.key === ' ' || (event.key === 'Escape' && pinned)) {
        event.preventDefault()
        if (!event.repeat) togglePin(at)
        return
      }
      let x = Math.floor(at.u * snapshot.width)
      let y = Math.floor(at.v * snapshot.height)
      switch (event.key) {
      case 'ArrowLeft': x--; break
      case 'ArrowRight': x++; break
      case 'ArrowUp': y--; break
      case 'ArrowDown': y++; break
      default: return
      }
      event.preventDefault()
      inspect({
        u: (Math.max(0, Math.min(snapshot.width - 1, x)) + 0.5) / snapshot.width,
        v: (Math.max(0, Math.min(snapshot.height - 1, y)) + 0.5) / snapshot.height,
      }, true)
    })
  }

  host.querySelector('[data-inspect-center]')?.addEventListener('click', () => {
    if (ready()) inspect(center, true)
  })

  return {
    reset (): void {
      if (!pinned) position = undefined
      feedback.textContent = ''
      for (const { canvas, cursor, readout } of panels) {
        cursor.hidden = true
        readout.textContent = pinnable ? '' : 'Move over a shape to inspect its ID'
        if (pinnable) canvas.setAttribute('aria-disabled', 'true')
      }
    },
    restore (): void {
      for (const { lane, canvas, viewport, readout } of panels) {
        const available = Boolean(snapshotFor(lane))
        readout.hidden = viewport.hidden
        if (pinnable) canvas.setAttribute('aria-disabled', String(!available))
        if (!available) readout.textContent = viewport.hidden ? '' : 'Pixel readout unavailable'
      }
      if (pinned && position) inspect(position)
    },
  }
}
