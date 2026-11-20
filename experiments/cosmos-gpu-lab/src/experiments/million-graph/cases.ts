import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [
  {
    id: 'moving-graph',
    title: 'Explore a large moving graph',
    kind: 'explore',
    question: 'How does a large graph move and respond to interaction on the GPU?',
    description: 'A dense-community graph updates and draws on WebGPU. Start with 65,536 points and increase the count up to one million.',
    tryIt: 'Press Run graph, then pan or select a point. The status shows the selected point ID.',
    reference: 'The recorded interaction study compares WebGPU variants on the same graph and input sequence.',
    acceptance: 'Check movement, pan, zoom and point selection in the live view. Use the recorded study for timings.',
    recorded: {
      conclusion: 'The separate matched study cut steady frame p95 by about 55% on the two million-point community fixtures.',
      date: '20 November 2026',
      environment: 'Apple M3, visible Chrome 157, luma 9.3.6 and 10.0.0-alpha.15.',
      scope: 'Dense-community and high-degree graphs, using the four-corner distant-force option. The matched run uses production-style circles and links.',
      limits: 'The full YouTube speed verdict is open after the WebGL moving selection failure. The live viewer uses a simpler draw path.',
      evidence: [
        { label: 'Matched benchmark scope', page: 'production-envelope' },
        { label: 'Original WebGPU interaction evidence', page: 'interactive-study' },
      ],
    },
  },
  {
    id: 'shared-repulsion',
    title: 'Share distant repulsion',
    kind: 'recorded',
    question: 'Can points share distant-force calculations without moving too differently?',
    description: 'The recorded comparison tests per-point, cell-center and four-corner distant forces on one-million-point graphs.',
    reference: 'The existing per-point WebGPU solver on the same initial graphs.',
    acceptance: 'Frame cost and layout differences are measured separately; no universal visual error threshold is claimed.',
    recorded: {
      conclusion: 'Four-corner sharing saved about 9 ms in median WebGPU tick time on both inputs and matched the reference more closely than one cell center.',
      date: 'Not recorded',
      environment: 'Apple M3, visible Chrome, luma WebGPU.',
      scope: 'Two starting distributions, one million points, 200 ticks and three timing runs per method.',
      limits: 'Time includes field build, simulation and drawing through GPU completion. The even-input p95 increased.',
      evidence: [{ label: 'Shared-repulsion evidence', page: 'cell-field' }, { label: 'Dense-community study', page: 'dense-communities' }],
    },
  },
  {
    id: 'large-graph-drawing',
    title: 'Drawing a million points',
    kind: 'recorded',
    question: 'How much of the drawing cost comes from points and links?',
    description: 'The same frozen million-point graph is drawn with points only, links only, or both.',
    reference: 'Matching camera and graph positions across separately timed draw layers.',
    acceptance: 'Paint and state checks accompany GPU timestamps; simulation and display presentation are outside the timing.',
    recorded: {
      conclusion: 'On the wide frozen view, reduced drawing lowered median draw completion time from 24.5 to 13.7 ms. ' +
        'The tested images and pick IDs still matched.',
      date: 'Not recorded',
      environment: 'Apple M3, Chrome 157, luma 10.0.0-alpha.15.',
      scope: 'One frozen million-point dense-community graph, with fitted and zoomed views, pixel checks and GPU-fenced timing.',
      limits: 'These isolated draw passes do not establish moving-frame or production-renderer cost on other graphs or devices.',
      evidence: [{ label: 'Point and link drawing evidence', page: 'draw-cost' }],
    },
  },
]
