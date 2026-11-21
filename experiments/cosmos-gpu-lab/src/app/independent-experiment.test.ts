import { expect, it } from 'vitest'
import { findExperiment } from './registry'
import { unlinkOtherExperiments } from './independent-experiment'

it('keeps experiment evidence and demo links while removing links to unrelated research', () => {
  const experiment = findExperiment('precision-diagnostics')!
  const host = document.createElement('div')
  host.innerHTML = `<p><a id="other" href="#/point-shapes?section=doc-shapes-evidence">Another result</a>
    <a id="own-evidence" href="#/precision-diagnostics?section=doc-addition-evidence">Own evidence</a>
    <a id="demo" href="#/dense-communities">Live demonstration</a>
    <a id="demo-case" href="#/youtube-network?section=try-friendships-262k">Live demonstration at a specific size</a>
    <a id="demo-evidence" href="#/dense-communities?section=doc-layout">Demo evidence</a>
    <a id="reference" href="#/vocabulary">Vocabulary</a>
    <a id="external" href="https://example.com/">External source</a></p>`
  unlinkOtherExperiments(host, experiment)
  expect(host.textContent).toContain('Another result')
  expect(host.querySelector('#other, #demo-evidence')).toBeNull()
  expect(host.querySelector('#own-evidence')).not.toBeNull()
  expect(host.querySelector('#demo')).not.toBeNull()
  expect(host.querySelector('#demo-case')).not.toBeNull()
  expect(host.querySelector('#reference')).not.toBeNull()
  expect(host.querySelector('#external')).not.toBeNull()
})
