import type { ExperimentCase } from '../../runtime/experiment'

export const precisionCases: ExperimentCase[] = [{
  id: 'addition-order',
  title: 'Floating-point addition order',
  kind: 'demonstrate',
  question: 'Can changing the order of additions change the result?',
  description: 'CPU and WebGPU add the same numbers one at a time, in groups, and as a tree. Compare each answer with the exact sum.',
  tryIt: 'Press Compare sums with the default 1,024 numbers. See which addition orders get the exact sum of 512.',
  reference: 'The exact integer sum and CPU float32 models of the same three addition orders.',
  acceptance: 'Results are observations: no accuracy or production pass threshold is assigned.',
  recorded: {
    conclusion: 'On 12 November CPU and WebGPU returned 1, 16 and 512 for serial, grouped and tree addition; the exact sum was 512. ' +
      'On 18 November rearranging the same values changed the WebGPU tree result from 512 to 256.',
    date: '12 and 18 November 2026',
    environment: 'Headless Chrome 157; M3 host on 12 November, Apple WebGPU adapter with model unreported on 18 November.',
    scope: '1,024 cancellation values; the follow-up compared two arrangements four times each.',
    limits: 'One browser session per study. A tree is not always exact; performance and production readiness were not assessed.',
    evidence: [{ label: 'Addition-order evidence', page: 'addition-evidence' }],
    charts: [{
      title: 'Tree addition matched the exact sum',
      context: 'Same 1,024 cancellation values on CPU and WebGPU · 12 November',
      bars: [['One at a time', 1], ['Tree', 512]],
      reference: { value: 512, label: '512 exact' },
    }],
  },
}, {
  id: 'gravity-accuracy',
  title: 'Gravity force accuracy',
  kind: 'compare',
  question: 'How accurately do the gravity calculations reproduce the intended force?',
  description: 'Compare the same frozen points using production WebGL, two WebGPU formulas, and a CPU model.',
  tryIt: 'Press Compare gravity with the default 257 points. Look for the largest force error and any failed compatibility checks in the table.',
  reference: 'The intended linear gravity law in double precision, and the existing float32 CPU polar model for compatibility.',
  acceptance: 'Legacy compatibility uses absolute 2e-5 plus relative 3e-5 per force component; mathematical accuracy has no pass budget.',
  recorded: {
    conclusion: 'The native WebGPU polar diagnostic reversed two axis forces on this machine. ' +
      'Cartesian WebGPU and production WebGL passed the existing compatibility gate on the recorded inputs.',
    date: '12 November 2026',
    environment: 'Apple M3 host, headless Chrome 157, luma 10.0.0-alpha.4; WebGL reported ANGLE Metal.',
    scope: 'Frozen, finite inputs at 257, 1,024 and 4,096 points with seed 5931.',
    limits: 'The axis failure is specific to the native diagnostic and this environment. Layout, integration, other devices and performance were not assessed.',
    evidence: [{ label: 'Gravity accuracy evidence', page: 'gravity-evidence' }],
  },
}]
