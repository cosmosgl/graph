import { expect, it, vi } from 'vitest'
import { createMillionGraphView } from '../million-graph/view'
import type { createResidentGraph } from './resident-graph'

it('uses a centered, fixed camera after both Run and Fit', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  let graph!: Awaited<ReturnType<typeof createResidentGraph>>
  let initial!: Float32Array
  let startedView!: Promise<Float32Array>
  let tick = 0
  let failure: string | undefined
  const view = await createMillionGraphView(host, {
    viewport: { width: 480, height: 340, pixelRatio: 1 },
    ready (backend, positions): void {
      graph = backend
      initial = positions
      startedView = graph.readView()
    },
    frame (frame): void { tick = frame.tick },
    failed (error): void { failure = error },
    submitted (): void {},
    feedback (): void {},
  })
  const click = (action: string): void => { host.querySelector<HTMLButtonElement>(`[data-${action}]`)!.click() }
  const waitForTick = async (target: number): Promise<void> => {
    await vi.waitFor(() => {
      expect(failure).toBeUndefined()
      expect(tick).toBeGreaterThanOrEqual(target)
    }, { timeout: 30000 })
  }
  const expectCentered = (box: Float32Array, positions: Float32Array): void => {
    let minX = Infinity; let maxX = -Infinity
    let minY = Infinity; let maxY = -Infinity
    for (let i = 0; i < positions.length; i += 4) {
      if (positions[i + 3] > 0.5) continue
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i])
      minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1])
    }
    expect(box[0] + box[2] / 2).toBeCloseTo((minX + maxX) / 2, 3)
    expect(box[1] + box[2] / 2).toBeCloseTo((minY + maxY) / 2, 3)
  }
  try {
    const count = host.querySelector<HTMLSelectElement>('[data-count]')!
    count.value = '65536'
    count.dispatchEvent(new Event('change'))
    click('play')
    await waitForTick(5)
    const firstFit = await startedView
    expectCentered(firstFit, initial)
    expect(await graph.readView()).toEqual(firstFit)

    click('pause')
    const moved = await graph.readPositions()
    expect(moved.some((value, index) => index % 4 < 2 && value !== initial[index])).toBe(true)
    graph.setCamera({ x: 1000, y: -1000, zoom: 2 })
    const pannedView = await graph.readView()
    click('fit')
    const nextFit = await vi.waitFor(async () => {
      const fitted = await graph.readView()
      expect(fitted).not.toEqual(pannedView)
      expectCentered(fitted, moved)
      return fitted
    }, { timeout: 5000 })

    const resumedTick = tick + 5
    click('play')
    await waitForTick(resumedTick)
    expect(await graph.readView()).toEqual(nextFit)
  } finally { view.destroy(); host.remove() }
}, 60000)
