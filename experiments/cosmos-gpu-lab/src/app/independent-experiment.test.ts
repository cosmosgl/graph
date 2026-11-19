import { expect, it } from 'vitest'
import { findExperiment } from './registry'
import { unlinkOtherExperiments } from './independent-experiment'

it('keeps scientific context and same-case evidence while removing links to independent experiments', () => {
  const experiment = findExperiment('precision-diagnostics')!
  const item = experiment.cases!.find(entry => entry.id === 'addition-order')!
  const host = document.createElement('div')
  host.innerHTML = `<p><a id="other" href="#/point-styling">Another result</a>
    <a id="sibling" href="#/precision-diagnostics?case=gravity-accuracy">Gravity result</a>
    <a id="other-evidence" href="#/precision-diagnostics?section=doc-gravity-evidence">Gravity evidence</a>
    <a id="own-evidence" href="#/precision-diagnostics?case=addition-order&section=doc-addition-evidence">Own evidence</a>
    <a id="reference" href="#/vocabulary">Vocabulary</a>
    <a id="external" href="https://example.com/">External source</a></p>`
  unlinkOtherExperiments(host, experiment, item, 'addition-evidence')
  expect(host.textContent).toContain('Another result')
  expect(host.textContent).toContain('Gravity result')
  expect(host.textContent).toContain('Gravity evidence')
  expect(host.querySelector('#other, #sibling, #other-evidence')).toBeNull()
  expect(host.querySelector('#own-evidence')).not.toBeNull()
  expect(host.querySelector('#reference')).not.toBeNull()
  expect(host.querySelector('#external')).not.toBeNull()
})
