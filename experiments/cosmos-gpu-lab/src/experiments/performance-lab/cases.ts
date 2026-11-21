import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'circle-rendering',
  title: 'Measure circle rendering',
  kind: 'measure',
  question: 'How long does each backend take to draw the same circles?',
  description: 'Measure matched WebGL and WebGPU circle draws on this device.',
  tryIt: 'Keep the quick preset and press Run benchmark. Compare the completion distributions after the samples finish.',
  reference: 'The same positions, colors, point count and canvas size for both backends.',
  acceptance: 'Completion includes submission and waiting for the GPU; no performance pass threshold is assigned.',
  recorded: null,
  evidence: [{ label: 'Benchmark method', page: 'methodology' }, { label: 'Reading the timings', page: 'interpretation' }],
}, {
  id: 'center-reduction',
  title: 'Measure center reduction',
  kind: 'measure',
  question: 'How long does each backend take to calculate the center of the same points?',
  description: 'Measure an isolated center reduction with WebGL and WebGPU on this device.',
  tryIt: 'Keep the quick preset and press Run benchmark. Compare completion times and the separately checked CPU center error.',
  reference: 'The same point data for both backends and a separate CPU center check.',
  acceptance: 'Report completion and the CPU check separately; a fast result does not establish complete-graph performance.',
  recorded: null,
  evidence: [{ label: 'Benchmark method', page: 'methodology' }, { label: 'Reading the timings', page: 'interpretation' }],
}]
