import { expect, it } from 'vitest'
import { renderResultChart } from '../runtime/result-chart'
import { renderMarkdown } from './markdown'

it('scales both bars and the limit from the same zero and preserves a measured zero', () => {
  const chart = renderResultChart({
    title: 'The old run missed the target',
    context: 'Maximum click feedback',
    unit: 'ms',
    bars: [['Original', 100], ['Replay', 0]],
    reference: { value: 50, label: '50 ms target', upperLimit: true },
  })
  const widths = Array.from(chart.querySelectorAll<HTMLElement>('.result-chart-bar'), bar => bar.style.width)
  expect(widths).toEqual(['94%', '0%'])
  const rows = chart.querySelector<HTMLElement>('.result-chart-rows')!
  expect(rows.style.getPropertyValue('--reference-position')).toBe('47%')
  expect(chart.querySelector('.result-chart-value.result-chart-over-limit')?.textContent).toBe('100 ms')
  expect(chart.querySelector('.result-chart-row:last-child .result-chart-value')?.textContent).toBe('0 ms')
})

it('draws the mean of two runs while labeling both measured values', () => {
  const chart = renderResultChart({
    title: 'Two solo runs',
    context: 'Average bar with the observed range',
    unit: 'FPS',
    bars: [['WebGL', [10, 14]], ['WebGPU', [20, 40]]],
  })
  const widths = Array.from(chart.querySelectorAll<HTMLElement>('.result-chart-bar'), bar => parseFloat(bar.style.width))
  expect(widths[0] / widths[1]).toBeCloseTo(12 / 30)
  expect(Array.from(chart.querySelectorAll('.result-chart-value'), label => label.textContent)).toEqual(['10–14 FPS', '20–40 FPS'])
})

it('renders a valid Markdown chart with literal labels and leaves an invalid fence as code', async () => {
  const host = document.createElement('div')
  const source = { title: '<img src=x>', context: 'Recorded comparison', bars: [['Before', 557], ['After', 0]] }
  const invalid = { ...source, bars: [['Before', 557], ['After', -1]] }
  await renderMarkdown(host, [source, invalid].map(chart => `\`\`\`result-chart\n${JSON.stringify(chart)}\n\`\`\``).join('\n\n'))
  expect(host.querySelectorAll('.result-chart')).toHaveLength(1)
  expect(host.querySelector('.result-chart-title')?.textContent).toBe('<img src=x>')
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('pre code.language-result-chart')?.textContent).toContain('"After",-1')
})
