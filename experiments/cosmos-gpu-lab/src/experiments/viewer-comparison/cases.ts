import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'compare-viewers',
  title: 'Compare production and WebGPU viewers',
  kind: 'compare',
  question: 'How do the two viewers behave on the same small graph?',
  description: 'Explore the Karate Club graph in the production WebGL viewer and the experimental WebGPU viewer.',
  tryIt: 'Press Run both, then select or drag a point in each viewer. Use Compare corrected link paint under Additional checks to check frozen colors.',
  reference: 'The existing production viewer, using the same graph and supplied point and link styles.',
  acceptance: 'The live views are for exploration. Separate recorded checks cover frame intervals, picking and fixed-position pixels.',
  recorded: {
    conclusion: 'Both viewers supported the small exploration workflow. Applying production’s short-link opacity in the candidate ' +
      'cleared all 557 original interior color failures across the two frozen styles.',
    date: '18–19 November 2026',
    environment: 'Apple M3; visible Chromium 157; production WebGL and experimental WebGPU.',
    scope: '34 points and 78 links, selected interactions and two fixed-position color styles.',
    limits: 'The color result covers one device and two fresh styles. The earlier selection-latency outlier remains unexplained.',
    evidence: [{ label: 'Viewer comparison evidence', page: 'findings' }, { label: 'Comparison method', page: 'method' }],
  },
}, {
  id: 'link-color-evidence',
  title: 'Investigate link-color differences',
  kind: 'recorded',
  question: 'What caused the original interior link colors to differ?',
  description: 'Frozen draws isolate individual links and check how projected length affects opacity.',
  reference: 'The production renderer and experimental renderer using the same frozen positions, camera and styles.',
  acceptance: 'Exact interior IDs and the existing 2/255 interior color tolerance; geometric edge pixels are evaluated separately.',
  recorded: {
    conclusion: 'WebGL boosted opacity on short links. The candidate matched every interior RGBA byte after applying the same rule.',
    date: '19 November 2026',
    environment: 'Apple M3, native Chrome 157; production WebGL and experimental WebGPU.',
    scope: 'Frozen Karate Club geometry and two styles, with point-only, link-only, smoothing and distance-opacity controls.',
    limits: 'Two styles at one camera on M3. Results for other adapters, styles and moving layouts are still open.',
    evidence: [{ label: 'Link-color evidence', page: 'link-color-evidence' }],
  },
}]
