import { compareArray } from '../weighted-links/reference'
import { createGraph, PRECISION_MODES, type SpringPrecision, type Stage } from './data'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedSession } from './session'
export type SpringStudyRow = {
  mode: SpringPrecision; capture: string; tick: number; forces?: ReturnType<typeof compareArray>;
  positions?: ReturnType<typeof compareArray>; error?: string;
}
export async function compareSpringPrecision (session: CombinedSession, cancelled: () => boolean = (): boolean => false): Promise<SpringStudyRow[]> {
  const captures = Object.entries(session.firstFailures).filter(([key]) => key.endsWith('-incoming') || key.endsWith('-outgoing'))
  const rows: SpringStudyRow[] = []
  if (!captures.length) return rows
  const { graph, input } = createGraph(session.settings)
  for (const mode of PRECISION_MODES) {
    if (cancelled()) break
    let backend: Awaited<ReturnType<typeof createCombinedWebGPU>> | undefined
    try {
      backend = await createCombinedWebGPU(document.createElement('canvas'), graph, input, mode)
      for (const [key, capture] of captures) {
        if (cancelled()) break
        const row: SpringStudyRow = { mode, capture: key, tick: capture.tick }; rows.push(row)
        try {
          backend.setPositions(capture.input)
          backend.stepStage(key.split('-').at(-1) as Stage, capture.alpha)
          const actual = await backend.read()
          row.forces = compareArray(actual.forces, capture.expected.forces)
          row.positions = compareArray(actual.positions, capture.expected.positions)
        } catch (error) { row.error = String(error) }
      }
    } catch (error) {
      for (const [key, capture] of captures) rows.push({ mode, capture: key, tick: capture.tick, error: String(error) })
    } finally { backend?.destroy() }
  }
  return rows
}
