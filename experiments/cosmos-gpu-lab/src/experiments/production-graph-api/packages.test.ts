import { expect, it } from 'vitest'
import { mountGraph } from './frame'

it.each(['webgl', 'webgpu'] as const)('preserves pinned and absent slots when the built %s Graph steps', async engine => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const host = frame.contentDocument!.createElement('div')
  host.style.cssText = 'width:480px;height:240px;position:relative'
  frame.contentDocument!.body.append(host)
  const graph = await mountGraph(host, engine)
  try {
    const before = await graph.positions()
    expect([...before]).toEqual([1984, 2048, 2112, 2048, NaN, NaN])
    const after = await graph.step()
    expect([...after.slice(0, 2)]).toEqual([1984, 2048])
    expect(after[2]).toBeLessThan(2112)
    expect(after[2]).toBeGreaterThan(2048)
    expect(after[3]).toBe(2048)
    expect(after.slice(4).every(Number.isNaN)).toBe(true)
  } finally { graph.destroy(); frame.remove() }
})
