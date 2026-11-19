import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'compare-viewers',
  title: 'Compare production and WebGPU viewers',
  kind: 'compare',
  question: 'How do the two viewers behave on the same small graph?',
  description: 'Explore the Karate Club graph in the production WebGL viewer and the experimental WebGPU viewer.',
  tryIt: 'Press Run both, then select or drag a point in each viewer. Use Fit both if a graph moves out of view.',
  reference: 'The existing production viewer, using the same graph and supplied point and link styles.',
  acceptance: 'The live views are for exploration. Separate recorded checks cover frame intervals, picking and fixed-position pixels.',
  recorded: {
    conclusion: 'Both viewers supported the small exploration workflow. A fixed-position comparison still found 557 interior link-color failures, ' +
      'even after an edge-smoothing control removed most edge differences.',
    date: '18–19 November 2026',
    environment: 'Apple M3; visible Chromium 157; production WebGL and experimental WebGPU.',
    scope: '34 points and 78 links, selected interactions and two fixed-position color styles.',
    limits: 'One device and a bounded workflow. The interior color difference and a previous selection-latency outlier remain unexplained.',
    evidence: [{ label: 'Viewer comparison evidence', page: 'findings' }, { label: 'Comparison method', page: 'method' }],
  },
}, {
  id: 'link-color-evidence',
  title: 'Investigate link-color differences',
  kind: 'recorded',
  question: 'Where do the recorded differences between viewer colors occur?',
  description: 'A fixed-position comparison isolates the link layer and tests a separate edge-smoothing control.',
  reference: 'The production renderer and experimental renderer using the same frozen positions, camera and styles.',
  acceptance: 'Exact interior IDs and the existing 2/255 interior color tolerance; geometric edge pixels are evaluated separately.',
  recorded: {
    conclusion: 'All 557 interior color failures remained in link-only draws. Edge smoothing removed most edge differences ' +
      'but none of those interior failures.',
    date: '19 November 2026',
    environment: 'Apple M3, native Chrome 157; production WebGL and experimental WebGPU.',
    scope: 'Frozen Karate Club geometry and two styles, with point-only and link-only controls.',
    limits: 'One device and two bounded styles. The underlying cause of the interior difference is not established.',
    evidence: [{ label: 'Link-color evidence', page: 'link-color-evidence' }],
  },
}]
