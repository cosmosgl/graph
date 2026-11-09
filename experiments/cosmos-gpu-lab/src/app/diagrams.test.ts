import { afterEach, describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'
import { sanitizeDiagram } from './sanitize-diagram'

const hosts: HTMLElement[] = []

function createHost (): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('GPU Lab diagram sanitization', () => {
  it('preserves Mermaid node and edge labels with visible dimensions', async () => {
    const host = createHost()
    await renderMarkdown(host, [
      '```mermaid',
      'flowchart LR',
      'A[GPUAdapter] -->|creates| B[GPUDevice]',
      '```',
    ].join('\n'), {}, { linkTerms: false })

    expect(host.querySelector('.diagram-error')).toBeNull()
    expect(host.querySelector('svg')).not.toBeNull()
    const labels = Array.from(host.querySelectorAll('foreignObject'))
    for (const text of ['GPUAdapter', 'creates', 'GPUDevice']) {
      const label = labels.find(element => element.textContent?.trim() === text)
      expect(label, text).toBeDefined()
      expect(label!.getBoundingClientRect().width).toBeGreaterThan(0)
      expect(label!.getBoundingClientRect().height).toBeGreaterThan(0)
    }
  })

  it('removes executable content across SVG and HTML namespace boundaries', () => {
    const host = createHost()
    host.append(sanitizeDiagram(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject width="200" height="100">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <span onclick="alert(1)">Readable label</span>
            <img src="x" onerror="alert(1)">
            <iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>
            <a href="javascript:alert(1)">Unsafe link</a>
          </div>
        </foreignObject>
        <a href="javascript:alert(1)"><text>SVG label</text></a>
      </svg>
    `))

    expect(host.querySelector('foreignObject span')?.textContent).toBe('Readable label')
    expect(host.querySelector('text')?.textContent).toBe('SVG label')
    expect(host.querySelector('script, iframe, [onload], [onerror], [onclick]')).toBeNull()
    for (const link of host.querySelectorAll('a')) expect(link.hasAttribute('href')).toBe(false)
  })
})
