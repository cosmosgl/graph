import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'compare-viewers',
  title: 'Compare clicks and drags in WebGL and WebGPU',
  kind: 'compare',
  question: 'Does each graph highlight the point you click?',
  description: 'Production WebGL and experimental WebGPU both start with the same 34-point Karate Club graph.',
  reference: 'Production WebGL with the same graph data, point styles and link styles.',
  acceptance: 'The live views are for exploration. Separate recorded checks cover frame intervals, picking and fixed-position pixels.',
  recorded: {
    conclusion: 'Point clicks and drags worked in both panels. Applying production’s short-link opacity in the candidate ' +
      'cleared all 557 original interior color failures across the two frozen styles.',
    date: '18–19 November 2026',
    environment: 'Apple M3; visible Chromium 157; production WebGL and experimental WebGPU.',
    scope: '34 points and 78 links, point interaction checks and two fixed-position color styles.',
    limits: 'The color result covers one device and two fresh styles. An earlier slow response to a click remains unexplained.',
    evidence: [{ label: 'Graph comparison findings', page: 'findings' }, { label: 'Comparison method', page: 'method' }],
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
    limits: 'Two styles at one camera on one GPU. Results for other adapters, styles and moving layouts are still open.',
    evidence: [{ label: 'Link-color evidence', page: 'link-color-evidence' }],
  },
}]
