import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'resize-preservation',
  title: 'Rebuild or reuse GPU buffers',
  kind: 'compare',
  question: 'How does reusing GPU buffers affect update time and buffer memory?',
  description: 'One preview rebuilds its GPU buffers every time the point count changes. The other reuses the buffers whenever the points fit.',
  tryIt: 'Click Add and remove points to run the chain through four point-count changes and return to 2,048 points.',
  reference: 'Rebuild the GPU buffers at each point-count change for the same chain graph.',
  acceptance: 'Record the time through GPU completion and the buffer memory after each change.',
  evidence: [{ label: 'Reusing GPU buffers', page: 'method' }],
  recorded: null,
}]
