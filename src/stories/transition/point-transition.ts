/**
 * Demonstrates GPU-driven point position transitions: a 200k-point cloud sampled
 * from a painting auto-loops between the picture layout and a sequence of tile scatters.
 */

import { Graph, defaultConfigValues, TransitionEasing } from '@cosmos.gl/graph'

import './transition.css'
import { loadPointData } from './point-data'
import {
  createPicturePositions,
  createTileScatterPositions,
} from './transition-helpers'

/**
 * Auto-loop sequence for point positions:
 * - number: render tile scatter with this `tileGridN` value (e.g. 2..16)
 * - undefined: render the original picture layout (no scatter)
 */
const LOOP_STEPS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  undefined,
  16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
  undefined,
]

export const pointTransition = async (): Promise<{
  graph: Graph;
  div: HTMLDivElement;
  destroy?: () => void;
}> => {
  const { cols, rows, aspect, colors: pictureColors } = await loadPointData()
  const spaceSize = defaultConfigValues.spaceSize

  let loopStepIndex = 0
  let loopIntervalId: ReturnType<typeof setInterval> | undefined

  const picturePositions = createPicturePositions(cols, rows, spaceSize, aspect)

  const div = document.createElement('div')
  div.className = 'app'
  div.style.background = defaultConfigValues.backgroundColor

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const fitViewAction = document.createElement('div')
  fitViewAction.className = 'action'
  fitViewAction.textContent = 'FitView'
  fitViewAction.title = 'Fit the camera to current points.'

  const pausePlayAction = document.createElement('div')
  pausePlayAction.className = 'action'
  pausePlayAction.textContent = 'Pause'
  pausePlayAction.title = 'Pause or resume the auto-loop.'

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  actionsDiv.appendChild(fitViewAction)
  actionsDiv.appendChild(pausePlayAction)
  div.appendChild(actionsDiv)

  const stopLoopTimer = (): void => {
    if (loopIntervalId === undefined) return
    clearInterval(loopIntervalId)
    loopIntervalId = undefined
  }

  const startLoop = (): void => {
    loopIntervalId = setInterval(() => {
      const step = LOOP_STEPS[loopStepIndex]
      if (step === undefined) {
        graph.setPointPositions(picturePositions)
      } else {
        const tilePositions = createTileScatterPositions(
          cols,
          rows,
          spaceSize,
          aspect,
          step
        )
        graph.setPointPositions(tilePositions)
      }
      graph.render()
      loopStepIndex = (loopStepIndex + 1) % LOOP_STEPS.length
    }, defaultConfigValues.transitionDuration)
  }

  const graph = new Graph(graphDiv, {
    enableSimulation: false,
    pointDefaultSize: 2,
    transitionEasing: TransitionEasing.CubicInOut,
    attribution:
      'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  })

  graph.setPointPositions(picturePositions)
  graph.setPointColors(pictureColors)
  graph.render()
  graph.fitView()
  startLoop()

  fitViewAction.addEventListener('click', () => {
    graph.fitView()
  })

  pausePlayAction.addEventListener('click', () => {
    if (loopIntervalId !== undefined) {
      stopLoopTimer()
      pausePlayAction.textContent = 'Play'
    } else {
      startLoop()
      pausePlayAction.textContent = 'Pause'
    }
  })

  return {
    div,
    graph,
    destroy: (): void => {
      stopLoopTimer()
      graph.destroy()
    },
  }
}
