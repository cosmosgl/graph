import { describe, expect, it } from 'vitest'

import '@cosmos.gl/graph'
import { GraphData } from '@/graph/modules/GraphData'
import { defaultConfigValues } from '@/graph/variables'

describe('resolving link channel defaults', () => {
  it('keeps NaN color channels in the caller array and reapplies changed defaults', () => {
    const config = { ...defaultConfigValues, linkDefaultColor: '#ff0000' }
    const data = new GraphData(config)
    const colors = new Float32Array([NaN, 0.25, NaN, 1])
    data.inputLinks = new Float32Array([0, 1])
    data.inputLinkColors = colors

    data.update()

    const firstResult = data.linkColors
    expect(Array.from(firstResult ?? [])).toEqual([1, 0.25, 0, 1])
    expect(Number.isNaN(colors[0])).toBe(true)
    expect(colors[1]).toBe(0.25)
    expect(Number.isNaN(colors[2])).toBe(true)
    expect(colors[3]).toBe(1)
    expect(firstResult).not.toBe(colors)

    data.update()
    expect(data.linkColors).toBe(firstResult)

    config.linkDefaultColor = '#00ff00'
    data.update()
    expect(Array.from(data.linkColors ?? [])).toEqual([0, 0.25, 0, 1])
    expect(Number.isNaN(colors[0])).toBe(true)
    expect(Number.isNaN(colors[2])).toBe(true)
  })

  it('keeps NaN widths in the caller array and reapplies changed defaults', () => {
    const config = { ...defaultConfigValues, linkDefaultWidth: 2 }
    const data = new GraphData(config)
    const widths = new Float32Array([NaN])
    data.inputLinks = new Float32Array([0, 1])
    data.inputLinkWidths = widths

    data.update()

    const firstResult = data.linkWidths
    expect(Array.from(firstResult ?? [])).toEqual([2])
    expect(Number.isNaN(widths[0])).toBe(true)
    expect(firstResult).not.toBe(widths)

    data.update()
    expect(data.linkWidths).toBe(firstResult)

    config.linkDefaultWidth = 3
    data.update()
    expect(Array.from(data.linkWidths ?? [])).toEqual([3])
    expect(Number.isNaN(widths[0])).toBe(true)
  })

  it('re-resolves an input array changed in place after its setter invalidates the cache', () => {
    const data = new GraphData({ ...defaultConfigValues, linkDefaultWidth: 2 })
    const widths = new Float32Array([NaN])
    data.inputLinks = new Float32Array([0, 1])
    data.inputLinkWidths = widths
    data.update()

    widths[0] = 4
    data.invalidateLinkWidthCache()
    data.update()

    expect(data.linkWidths?.[0]).toBe(4)
  })
})
