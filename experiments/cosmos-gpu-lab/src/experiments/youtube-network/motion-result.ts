import type { ResultChart } from '../../runtime/result-chart'

// Recorded in youtube-300k-solo-cost.spM29b using the two regular lanes per backend.
export const youtubeMotionResult: ResultChart = {
  title: 'WebGPU moved the 300k YouTube graph at about 59 FPS',
  context: 'GPU-completed frames on Apple M3 · Two solo runs each with the built WebGL Graph and Lab WebGPU prototype',
  unit: 'FPS',
  bars: [['WebGL', [16.3, 16.4]], ['WebGPU', [57.9, 59.8]]],
}
