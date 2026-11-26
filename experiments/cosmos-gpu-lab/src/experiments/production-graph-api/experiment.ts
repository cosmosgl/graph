import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'production-graph-api',
  title: 'Run the same Graph application',
  summary: 'Compare stepping, point styles, removal, curved links, hover, selection and tracking through the two built Cosmos packages.',
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
    id: 'interrupted-removal',
    title: 'Restore a point halfway through its fade',
    kind: 'compare',
    question: 'What happens to point 1 and its link when the point returns before its removal fade finishes?',
    description: 'Restore point 1 at a new position 500 ms into its one-second fade. Compare the frames and IDs on both sides of the interruption.',
    reference: 'Both Graph packages receive the same position edits, frozen clock, clicks, rectangles and lassos.',
    acceptance: 'Compare the drawn point and link with the click, rectangle and lasso IDs at the old and new positions throughout restoration.',
    recorded: null,
  }, {
    id: 'remove-again',
    title: 'Remove a point halfway through restoration',
    kind: 'compare',
    question: 'What happens to point 1 and its link when the point is removed halfway to its new position?',
    description: 'Restore point 1 halfway through its fade, then remove it again as it reaches the midpoint. Inspect both frames at that edit.',
    reference: 'Both built Graph packages receive identical edits, transition times and probes at the old center, midpoint and destination.',
    acceptance: 'Compare the painted point and link, click targets and selected point IDs at all three positions before and after the second removal.',
    recorded: null,
  }, {
    id: 'restore-original',
    title: 'Return to the original position',
    kind: 'compare',
    question: 'What can you see and select when point 1 returns to its original position halfway through its second removal?',
    description: 'Start the return at 500 ms of the second fade. Compare the point and link as the center travels from x = 64 back to x = 48.',
    reference: 'Both built Graph packages receive the same timed edits, clicks, rectangles and diamond lassos.',
    acceptance: 'Compare the pixels and exact IDs at the original position, midpoint and first target on each return frame.',
    recorded: null,
  }, {
    id: 'remove-on-return',
    title: 'Remove a point on its return to the original position',
    kind: 'compare',
    question: 'Where does point 1 fade, and which positions still select it when you remove it at x = 56?',
    description: 'Remove point 1 as it travels from x = 64 back to x = 48. Compare the drawing and IDs on both sides of that edit.',
    reference: 'Both built packages receive the same timed edits and click, rectangle and diamond lasso probes at x = 48, 56, 64 and 80.',
    acceptance: 'Compare each painted frame and the exact IDs at all four positions through the third removal.',
    recorded: null,
  }, {
    id: 'restore-to-80',
    title: 'Restore point 1 at x = 80 during the third fade',
    kind: 'compare',
    question: 'What can you see and select when point 1 returns to x = 80 halfway through its third removal?',
    description: 'Restore the point 500 ms into the third fade at x = 56. Compare its paint, link and selected IDs as it moves to x = 80.',
    reference: 'Both built packages receive the same timed edits and the same probes at x = 48, 56, 64 and 80.',
    acceptance: 'Compare the full frames, clicks, rectangles and diamond lassos at all four positions before and after the restoration.',
    recorded: null,
  }, {
    id: 'remove-at-68',
    title: 'Remove point 1 at x = 68',
    kind: 'compare',
    question: 'What stays visible and selectable when you remove point 1 halfway back to x = 80?',
    description: 'Remove point 1 at x = 68, 500 ms into its trip from x = 56 to x = 80. Inspect the frames on both sides of the edit and through the fade.',
    reference: 'Both built Graph packages receive the same timed edits and probes at x = 48, 56, 64, 68 and 80.',
    acceptance: 'Compare the point and link pixels, click targets and exact rectangle and lasso IDs at all five positions.',
    recorded: null,
  }, {
    id: 'curved-link-crossing',
    title: 'Move a curved link across a point',
    kind: 'compare',
    question: 'When a curved link crosses a stationary point, which one is visible and which ID does a click return?',
    description: 'Move both link endpoints together. Inspect the same point before, during and after the crossing.',
    reference: 'Both Graph packages receive the same position transition and clicks at the same times.',
    acceptance: 'Compare the painted overlap and click IDs with the link and background controls at 1× and 2×.',
    recorded: null,
  }, {
    id: 'curved-link-image-crossing',
    title: 'Move a curved link behind a point image',
    kind: 'compare',
    question: 'What shows through each part of a point image, and which object receives the click?',
    description: 'Move green link 0 behind image point 2. From left to right the three areas are opaque red, translucent red and transparent.',
    reference: 'Both Graph packages replay the same motion twice, with and without image point 2.',
    acceptance: 'Compare the pixel color and click ID in all three areas before, during and after the crossing at 1× and 2×.',
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
    if (caseId === 'interrupted-removal') return (await import('./sparse-view')).createSparseView(host, 'interrupted')
    if (caseId === 'remove-again') return (await import('./sparse-view')).createSparseView(host, 'remove-again')
    if (caseId === 'restore-original') return (await import('./sparse-view')).createSparseView(host, 'restore-original')
    if (caseId === 'remove-on-return') return (await import('./sparse-view')).createSparseView(host, 'remove-on-return')
    if (caseId === 'restore-to-80') return (await import('./sparse-view')).createSparseView(host, 'restore-to-80')
    if (caseId === 'remove-at-68') return (await import('./sparse-view')).createSparseView(host, 'remove-at-68')
    if (caseId === 'curved-link-crossing') return (await import('./curved-crossing-view')).createCurvedCrossingView(host)
    if (caseId === 'curved-link-image-crossing') return (await import('./image-crossing-view')).createImageCrossingView(host)
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
