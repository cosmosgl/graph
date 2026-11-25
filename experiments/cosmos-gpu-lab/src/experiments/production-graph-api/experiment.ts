import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'production-graph-api',
  title: 'Run the same Graph application',
  summary: 'Compare manual stepping, point styles, removal, hover, selection and tracking through the two built Cosmos packages.',
  tags: ['integration', 'interaction', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: {
    summary: 'Each comparison runs the same application with the built WebGL and WebGPU packages.',
  },
  cases: [{
    id: 'manual-step',
    title: 'A pinned point and a moving endpoint',
    kind: 'compare',
    question: 'Do both Graph packages draw, pick and step the same points?',
    description: 'Each frame runs the same application against its own built Graph package.',
    reference: 'The WebGL package and the fixed positions and IDs used in the Manual step Storybook example.',
    acceptance: 'Point 0 stays pinned, point 1 moves toward the center and point 2 stays absent. Clicking a visible point reports its ID.',
    recorded: null,
  }, {
    id: 'sparse-transition',
    title: 'Remove and restore a point',
    kind: 'compare',
    question: 'When does a fading point leave a selection, and when can you select it at its new position?',
    description: 'Remove point 1 and restore it 32 CSS px to the right. Compare the paint, click hits and area selections at each checkpoint.',
    reference: 'Both standalone Graph packages receive the same edits, clock times, clicks, rectangles and lasso paths.',
    acceptance: 'Check the exact rectangle and lasso IDs at the old, intermediate and new positions. The two surviving points keep their coordinates and IDs.',
    recorded: null,
  }, {
    id: 'stationary-hover',
    title: 'Hover under a stationary pointer',
    kind: 'compare',
    question: 'Which point gets the hover ring when the graph moves under a parked pointer?',
    description: 'Move points and zoom the camera with a fixed cursor. Inspect the rendered ring and the callbacks in each package.',
    reference: 'The WebGL Graph receives the same point updates, camera changes and pointer events.',
    acceptance: 'Both packages report the same point IDs and callback order. The ring follows the hovered point and clears when the pointer leaves.',
    recorded: null,
  }, {
    id: 'point-style-updates',
    title: 'Change only point colors and sizes',
    kind: 'compare',
    question: 'What happens to a point and its link when a color or size change interrupts a transition?',
    description: 'Compare the drawn point, its endpoint-colored link, clicks and selected IDs as the point shrinks and regrows.',
    reference: 'Both Graph packages receive the same edits, clicks, rectangles and lasso paths at the same transition times.',
    acceptance: 'WebGPU clicks follow the displayed size. WebGL holds its last hit during the transition. ' +
      'Both packages must return the expected rectangle and lasso IDs at each checkpoint.',
    recorded: null,
  }, {
    id: 'headless-trackers',
    title: 'Two headless point trackers',
    kind: 'compare',
    question: 'Does one tracker keep reporting the right positions when another changes or is destroyed?',
    description: 'Follow two groups in a headless simulation. Change the points in one group, destroy its tracker, then step the survivor.',
    reference: 'Each tracker is checked against a full position read from its own simulation at the same checkpoint.',
    acceptance: 'Both packages report the requested point IDs and coordinates. The surviving tracker continues to follow its own group.',
    recorded: null,
  }],
  create: async (host, caseId) => {
    if (caseId === 'sparse-transition') return (await import('./sparse-view')).createSparseView(host)
    if (caseId === 'stationary-hover') return (await import('./stationary-hover-view')).createStationaryHoverView(host)
    if (caseId === 'headless-trackers') return (await import('./tracker-view')).createTrackerView(host)
    if (caseId === 'point-style-updates') return (await import('./point-style-view')).createPointStyleView(host)
    return (await import('./view')).createPackageView(host)
  },
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Reproduce the package comparison',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'youtube-selection',
    title: 'Moving YouTube selection and labels',
    load: async (): Promise<string> => (await import('./youtube-selection.md?raw')).default,
  }],
})
