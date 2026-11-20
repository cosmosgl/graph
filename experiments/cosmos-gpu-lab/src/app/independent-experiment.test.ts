import { expect, it } from 'vitest'
import { findExperiment } from './registry'
import { unlinkOtherExperiments } from './independent-experiment'

it('keeps same-case evidence and demo links while removing links to unrelated research', () => {
  const experiment = findExperiment('precision-diagnostics')!
  const item = experiment.cases!.find(entry => entry.id === 'addition-order')!
  const host = document.createElement('div')
  host.innerHTML = `<p><a id="other" href="#/point-styling">Another result</a>
    <a id="sibling" href="#/precision-diagnostics?case=gravity-accuracy">Gravity result</a>
    <a id="other-evidence" href="#/precision-diagnostics?section=doc-gravity-evidence">Gravity evidence</a>
    <a id="own-evidence" href="#/precision-diagnostics?case=addition-order&section=doc-addition-evidence">Own evidence</a>
    <a id="demo" href="#/dense-communities">Live demonstration</a>
    <a id="demo-case" href="#/youtube-network?section=try-friendships-262k">Live demonstration at a specific size</a>
    <a id="demo-evidence" href="#/dense-communities?section=doc-layout">Demo evidence</a>
    <a id="reference" href="#/vocabulary">Vocabulary</a>
    <a id="external" href="https://example.com/">External source</a></p>`
  unlinkOtherExperiments(host, experiment, item, 'addition-evidence')
  expect(host.textContent).toContain('Another result')
  expect(host.textContent).toContain('Gravity result')
  expect(host.textContent).toContain('Gravity evidence')
  expect(host.querySelector('#other, #sibling, #other-evidence, #demo-evidence')).toBeNull()
  expect(host.querySelector('#own-evidence')).not.toBeNull()
  expect(host.querySelector('#demo')).not.toBeNull()
  expect(host.querySelector('#demo-case')).not.toBeNull()
  expect(host.querySelector('#reference')).not.toBeNull()
  expect(host.querySelector('#external')).not.toBeNull()
})
