import { expect, it } from 'vitest'
import { findExperiment } from './registry'
import { unlinkOtherExperiments } from './independent-experiment'

it('keeps scientific context and same-case evidence while removing links to independent experiments', () => {
  const experiment = findExperiment('center-mass')!
  const item = experiment.cases!.find(entry => entry.id === 'center-comparison')!
  const host = document.createElement('div')
  host.innerHTML = `<p><a id="other" href="#/point-styling">Another result</a>
    <a id="sibling" href="#/center-mass?case=center-measurements">Cost result</a>
    <a id="other-evidence" href="#/center-mass?section=doc-cost-evidence">Cost evidence</a>
    <a id="own-evidence" href="#/center-mass?case=center-comparison&section=doc-results">Own evidence</a>
    <a id="reference" href="#/vocabulary">Vocabulary</a>
    <a id="external" href="https://example.com/">External source</a></p>`
  unlinkOtherExperiments(host, experiment, item, 'results')
  expect(host.textContent).toContain('Another result')
  expect(host.textContent).toContain('Cost result')
  expect(host.textContent).toContain('Cost evidence')
  expect(host.querySelector('#other, #sibling, #other-evidence')).toBeNull()
  expect(host.querySelector('#own-evidence')).not.toBeNull()
  expect(host.querySelector('#reference')).not.toBeNull()
  expect(host.querySelector('#external')).not.toBeNull()
})
