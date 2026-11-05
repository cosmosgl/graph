import { expect, it, vi } from 'vitest'
import { areaSelection } from '../src/stories/interaction/area-selection'

it.each(['Rectangle', 'Lasso'])('keeps the %s preview selected while zooming during a drag', async tool => {
  const story = areaSelection()
  story.div.style.cssText = 'width:640px;height:440px'
  document.body.appendChild(story.div)
  try {
    await story.graph.ready
    // Let the initial ResizeObserver apply its preset before interacting.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    story.div.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)!.click()
    story.div.querySelector<HTMLButtonElement>('[data-preset="corner"]')!.click()
    const overlay = story.div.querySelector('svg')!
    const outline = overlay.querySelector('.selection-outline')!
    const caption = story.div.querySelector('.selection-caption')!
    const status = story.div.querySelector('[role="status"]')!
    expect(caption.textContent).toContain('circle stays outside')
    // These synthetic gestures exercise the story handlers; native pointer
    // capture requires a trusted pointer and is unrelated to the preview state.
    const capture = vi.spyOn(overlay, 'setPointerCapture').mockImplementation(() => {})
    const bounds = overlay.getBoundingClientRect()
    const pointer = (type: string, x: number, y: number): PointerEvent => new PointerEvent(type, {
      pointerId: 1, button: 0, clientX: bounds.left + x, clientY: bounds.top + y, bubbles: true,
    })
    outline.dispatchEvent(pointer('pointerdown', 320, 280))
    overlay.dispatchEvent(pointer('pointermove', 270, 260))
    expect(caption.textContent).toBe('')
    expect(status.textContent).toBe('Selected: Circle')
    const preview = outline.getAttribute('d')
    const zoomBefore = story.graph.getZoomLevel()
    overlay.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, clientX: bounds.left + 270, clientY: bounds.top + 260, bubbles: true, cancelable: true,
    }))
    await vi.waitFor(() => { expect(story.graph.getZoomLevel()).toBeGreaterThan(zoomBefore) })
    expect(outline.getAttribute('d')).toBe(preview)
    expect(story.graph.findPointsInRect([[224, 244], [316, 285]])).toEqual([0])
    expect(status.textContent).toBe('Selected: Circle')
    overlay.dispatchEvent(pointer('pointerup', 270, 260))
    capture.mockRestore()
    // Presets restore their explanation; a subsequent zoom clears it again.
    story.div.querySelector<HTMLButtonElement>('[data-preset="corner"]')!.click()
    expect(caption.textContent).not.toBe('')
    expect(story.graph.getZoomLevel()).toBe(1)
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true }))
    expect(caption.textContent).toBe('')
    // A slight zoom-out must start from the reset view, not the old gesture.
    expect(story.graph.getZoomLevel()).toBeLessThan(1)
    // Resizing reapplies the preset too, and must preserve the same continuity.
    overlay.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, clientX: bounds.left + 270, clientY: bounds.top + 260, bubbles: true, cancelable: true,
    }))
    expect(story.graph.getZoomLevel()).toBeGreaterThan(1)
    story.div.style.width = '720px'
    await vi.waitFor(() => {
      expect(overlay.getAttribute('viewBox')).toBe('0 0 720 440')
      expect(story.graph.getZoomLevel()).toBe(1)
    })
    const positions = story.graph.getPointPositions()
    const [x, y] = story.graph.spaceToScreenPosition([positions[0]!, positions[1]!])
    expect(x).toBeCloseTo(290, 2)
    expect(y).toBeCloseTo(240, 2)
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true }))
    expect(story.graph.getZoomLevel()).toBeLessThan(1)
  } finally {
    vi.restoreAllMocks()
    story.destroy()
    story.graph.destroy()
    story.div.remove()
  }
})

it.each([
  { axis: 'horizontal', start: [215, 240], end: [285, 240], destination: [250, 300] },
  { axis: 'vertical', start: [250, 205], end: [250, 275], destination: [310, 240] },
])('commits moves of a $axis lasso converted to a degenerate rectangle', async ({ start, end, destination }) => {
  const story = areaSelection()
  story.div.style.cssText = 'width:640px;height:440px'
  document.body.appendChild(story.div)
  try {
    await story.graph.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    story.div.querySelector<HTMLButtonElement>('[data-preset="edge"]')!.click()
    story.div.querySelector<HTMLButtonElement>('[data-tool="Lasso"]')!.click()
    const overlay = story.div.querySelector('svg')!
    const outline = overlay.querySelector('.selection-outline')!
    const status = story.div.querySelector('[role="status"]')!
    vi.spyOn(overlay, 'setPointerCapture').mockImplementation(() => {})
    const bounds = overlay.getBoundingClientRect()
    const pointer = (type: string, point: number[]): PointerEvent => new PointerEvent(type, {
      pointerId: 1, button: 0, clientX: bounds.left + point[0]!, clientY: bounds.top + point[1]!, bubbles: true,
    })
    overlay.dispatchEvent(pointer('pointerdown', start))
    overlay.dispatchEvent(pointer('pointermove', [250, 240]))
    overlay.dispatchEvent(pointer('pointerup', end))
    story.div.querySelector<HTMLButtonElement>('[data-tool="Rectangle"]')!.click()
    expect(status.textContent).toBe('Selected: Circle')
    const original = outline.getAttribute('d')
    outline.dispatchEvent(pointer('pointerdown', [250, 240]))
    overlay.dispatchEvent(pointer('pointermove', destination))
    const preview = outline.getAttribute('d')
    expect(preview).not.toBe(original)
    expect(status.textContent).toBe('Selected: none')
    overlay.dispatchEvent(pointer('pointerup', destination))
    expect(outline.getAttribute('d')).toBe(preview)
    expect(status.textContent).toBe('Selected: none')
    // An empty newly drawn rectangle still leaves the committed selection alone.
    overlay.dispatchEvent(pointer('pointerdown', [430, 350]))
    overlay.dispatchEvent(pointer('pointermove', [450, 350]))
    overlay.dispatchEvent(pointer('pointerup', [450, 350]))
    expect(outline.getAttribute('d')).toBe(preview)
    expect(status.textContent).toBe('Selected: none')
  } finally {
    vi.restoreAllMocks()
    story.destroy()
    story.graph.destroy()
    story.div.remove()
  }
})
