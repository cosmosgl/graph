import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'explore-graph',
  title: 'Explore the Karate Club graph',
  kind: 'explore',
  question: 'Can you inspect and move members while the graph runs?',
  description: 'Explore a 34-member social graph using the experimental WebGPU viewer.',
  tryIt: 'Press Run, then select a circle to see its neighbors. Drag a member, or use Fit graph to return to the whole view.',
  reference: 'The supplied Karate Club topology and member IDs, with the existing WebGPU graph runtime.',
  acceptance: 'Selection should identify the chosen member. The recorded feedback check uses a 50 ms limit.',
  recorded: {
    conclusion: 'The explorer worked in the tested workflow, but one running selection took 100.4 ms and missed the 50 ms limit. ' +
      'Later controls passed without reproducing the delay.',
    date: '18–19 November 2026',
    environment: 'Apple M3, visible Chromium 157 and Chrome 157; Apple WebGPU / Metal 3.',
    scope: '34 members, 78 links, two initial viewport sizes and later bounded picking controls.',
    limits: 'The two earlier selection delays remain unexplained. The original measured source was not independently snapshotted; ' +
      'larger graphs were not accepted.',
    evidence: [{ label: 'Selection feedback evidence', page: 'latency-evidence' }, { label: 'Original viewer findings', page: 'findings' }],
  },
}, {
  id: 'selection-feedback',
  title: 'Investigate selection feedback',
  kind: 'recorded',
  question: 'Did later selection checks reproduce the recorded feedback delay?',
  description: 'The initial slow selection is compared with later checks at different canvas sizes and pixel ratios.',
  reference: 'The existing 50 ms feedback limit, including the next animation opportunity after the highlight completes.',
  acceptance: 'Every measured selection must finish within the limit; later passing controls do not erase the original failure.',
  recorded: {
    conclusion: 'One original running selection took 100.4 ms. Later narrow and wider controls completed their selections within 50 ms.',
    date: '18–19 November 2026',
    environment: 'Apple M3; visible Chromium 157 and standalone Chrome 157; Apple WebGPU / Metal 3.',
    scope: 'The original wider window and three later bounded controls, including DPR 1 and DPR 2.',
    limits: 'The original delay and an earlier 68.2 ms failure remain unexplained. The controls do not establish the cause or larger-graph responsiveness.',
    evidence: [{ label: 'Selection feedback evidence', page: 'latency-evidence' }],
  },
}]
