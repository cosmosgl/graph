import { Graph } from '@cosmos.gl/graph'
import { loadManualStep, manualStepConfig } from './manual-step-fixture'

/** Run a single gravity step with one pinned endpoint and one absent point. */
export function manualStep (): { graph: Graph; div: HTMLDivElement } {
  const div = document.createElement('div')
  div.style.cssText = 'position:relative;width:100%;height:100vh'
  const controls = document.createElement('div')
  controls.style.cssText = 'position:absolute;top:16px;left:16px;z-index:1;display:grid;gap:6px;color:white;font:14px system-ui'
  const step = document.createElement('button')
  step.textContent = 'Step gravity'
  step.disabled = true
  const position = document.createElement('output')
  const selection = document.createElement('output')
  controls.append(step, position, selection)
  div.append(controls)

  const graph = new Graph(div, {
    ...manualStepConfig,
    onPointClick: (index): void => { selection.textContent = `Selected point ${index}` },
  })
  loadManualStep(graph)

  const showPositions = async (): Promise<void> => {
    const xy = await graph.getPointPositionsAsync()
    if (xy.length === 6) {
      position.textContent = `Pinned x ${xy[0]?.toFixed(1)} · Free x ${xy[2]?.toFixed(1)}`
    }
  }
  const showError = (error: unknown): void => { position.textContent = String(error) }
  graph.ready.then(async () => {
    await showPositions()
    step.disabled = false
  }).catch(showError)
  step.onclick = (): void => {
    step.disabled = true
    graph.step()
    showPositions().catch(showError).finally(() => { step.disabled = false })
  }
  return { graph, div }
}
