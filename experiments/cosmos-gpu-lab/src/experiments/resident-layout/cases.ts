import type { ExperimentCase } from '../../runtime/experiment'

export const boundsCase: ExperimentCase = {
  id: 'resident-comparison',
  title: 'CPU bounds and GPU bounds',
  kind: 'compare',
  question: 'Can WebGPU find the bounds for the repulsion grid on the GPU, as Cosmos WebGL does?',
  description: 'Both previews use WebGPU. One downloads positions to calculate the bounds on the CPU. The other calculates them on the GPU.',
  tryIt: 'Run the same 128-point chain for 20 steps in each preview.',
  reference: 'The CPU-bounds preview uses the same layout code as the GPU-bounds preview.',
  acceptance: 'Count the position readbacks for bounds and compare bounds, positions, forces, and grid data at five checkpoints.',
  evidence: [
    { label: 'Why it matters for WebGPU', page: 'method' },
    { label: 'Migration checklist', page: 'checklist' },
  ],
  recorded: null,
}

export const editCase: ExperimentCase = {
  id: 'resident-edits',
  title: 'Edit the current layout',
  kind: 'demonstrate',
  question: 'Can points and links change without restarting the layout?',
  description: 'Move and pin a point or replace the links, then advance from the layout already on screen.',
  tryIt: 'Advance one step, make an edit, then advance again.',
  reference: 'Both previews start each step with the same edits applied.',
  acceptance: 'Edits keep the current step and reuse the position buffers. The next checked layouts must match.',
  evidence: [{ label: 'Updating a running layout', page: 'method' }],
  recorded: null,
}

export const timingCase: ExperimentCase = {
  id: 'resident-frame-cost',
  title: 'GPU time with and without drawing',
  kind: 'measure',
  question: 'How much GPU work do simulation and basic drawing take?',
  description: 'Measure the first few steps of a graph with and without drawing its points and links.',
  tryIt: 'Choose a graph and point count, then measure the same starting layout in all four workloads.',
  reference: 'The same starting graph and number of evolving frames for each workload.',
  acceptance: 'Report GPU work, CPU submission time, and completion time separately for completed batches.',
  evidence: [
    { label: 'Recorded frame timings', page: 'recorded' },
    { label: 'Measuring a GPU layout frame', page: 'method' },
  ],
  recorded: null,
}
