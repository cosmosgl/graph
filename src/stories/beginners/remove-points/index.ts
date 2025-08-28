import { Graph } from '@cosmos.gl/graph'
import { generateData } from './data-gen'
import { config } from './config'
import './style.css'

export const removePoints = (): { graph: Graph; div: HTMLDivElement} => {
  const { pointPositions, links } = generateData()
  const div = document.createElement('div')
  div.className = 'app'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  div.appendChild(actionsDiv)

  let isPaused = false

  let graphLinks = links

  const graph = new Graph(graphDiv, {
    ...config,
    onPointClick: (i): void => {
      if (i !== undefined) {
        // Filter out the clicked point from positions array
        const currentPositions = graph.getPointPositions()
        const newPointPositions = currentPositions
          .filter((pos, posIndex) => {
            return (
              (posIndex % 2 === 0 && posIndex !== i * 2) ||
            (posIndex % 2 === 1 && posIndex !== i * 2 + 1)
            )
          })

        // Convert links array to source-target pairs for easier filtering
        const pairedNumbers = []
        for (let j = 0; j < graphLinks.length; j += 2) {
          const pair = [graphLinks[j], graphLinks[j + 1]]
          pairedNumbers.push(pair)
        }

        // Remove links connected to deleted point and adjust indices of remaining links
        graphLinks = (pairedNumbers
          .filter(
            ([sourceIndex, targetIndex]) => sourceIndex !== i && targetIndex !== i
          )
          .flat() as number[])
          .map((p) => {
            if (p > i) return p - 1
            else return p
          })

        graph.setPointPositions(new Float32Array(newPointPositions))
        graph.setLinks(new Float32Array(graphLinks))
        graph.render(isPaused ? 0 : undefined)
      }
      console.log('Clicked node: ', i)
    },
  })
  graph.setPointPositions(new Float32Array(pointPositions))
  graph.setLinks(new Float32Array(graphLinks))
  graph.render()
  graph.zoom(0.9)

  /* ~ Demo Actions ~ */
  // Start / Pause
  const pauseButton = document.createElement('div')
  pauseButton.className = 'action'
  pauseButton.textContent = 'Pause'
  actionsDiv.appendChild(pauseButton)

  function pause (): void {
    isPaused = true
    pauseButton.textContent = 'Start'
    graph.pause()
  }

  function start (): void {
    isPaused = false
    pauseButton.textContent = 'Pause'
    graph.start()
  }

  function togglePause (): void {
    if (isPaused) start()
    else pause()
  }

  pauseButton.addEventListener('click', togglePause)

  return { div, graph }
}
