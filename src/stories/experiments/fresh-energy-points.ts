import { scaleSequential } from 'd3-scale'
import { interpolateRainbow } from 'd3-scale-chromatic'
import { Graph, getRgbaColor, defaultConfigValues } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'

/**
 * The core problem: add new points to a converged embedding without
 * disturbing the points that have already settled, so the layout the user
 * has learned survives — streaming out-of-sample extension (openTSNE's
 * `transform()`), running live in the force simulation.
 *
 * The mechanism is per-point energy (`setPointEnergies`): energy multiplies
 * the forces applied to a point, and a point at zero is frozen — it ignores
 * all forces but still exerts them, so the converged embedding acts as a
 * rigid reference frame newcomers can feel. The whole schedule runs on the
 * GPU: `simulationEnergyDecay` cools every point's energy each tick until
 * it freezes, and `simulationEnergyDiffusion` spreads energy along links
 * (scaled by link strength). The global simulation never cools; convergence
 * is a per-point property, which is what makes insertion-at-any-time
 * possible.
 *
 * Insertion (the button): each newcomer starts near the mean of its kNN
 * neighbors' positions with full energy and flies the last stretch, drawn
 * white. Its energy diffuses into the landing neighborhood — A-tSNE's
 * selective re-optimization — waking it (drawn faded) so it can make room,
 * then everything freezes back; points beyond the wake's reach never move.
 * A point that freezes with its springs still stretched never found a good
 * home and stays white.
 *
 * The demo data is a synthetic "MNIST": 10 Gaussian classes in 16-D,
 * arranged in confusable pairs. Attraction follows the kNN graph of the
 * feature space (Gaussian weights), repulsion is t-SNE's Student-t kernel.
 */
export const freshEnergyPoints = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const nClasses = 10
  const pointsPerClass = 150
  const dims = 16
  // BH-tSNE keeps ~3×perplexity neighbors; K=15 ≈ perplexity 5
  const knnPerPoint = 15
  const freshCount = 10
  // Engine-side energy schedule: decay ~15 s from full energy to frozen;
  // diffusion spreads a newcomer's energy along its links (× link strength
  // per hop), waking the landing neighborhood so it makes room.
  const energyDecay = 0.995
  const energyDiffusion = 0.5
  const linkDistance = 20
  // A point that freezes while its springs are still stretched way past
  // rest length never found a good home — it keeps its white color.
  const distressedLinkLength = linkDistance * 4
  const spaceSize = defaultConfigValues.spaceSize

  const classColorScale = scaleSequential(interpolateRainbow)
  classColorScale.domain([0, nClasses])

  const randomNormal = (): number => {
    // Box–Muller
    const u = 1 - Math.random()
    const v = Math.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  // Class centers come in pairs around shared "super-centers", so paired
  // classes overlap in feature space and become confusable neighbors —
  // like the digits 4/9 or 3/5/8 in MNIST. Cross-class kNN edges emerge
  // where the paired clouds mix, with honestly lower Gaussian weights.
  const classCenters: Float32Array[] = []
  for (let s = 0; s < nClasses / 2; s += 1) {
    const superCenter = Float32Array.from({ length: dims }, () => randomNormal() * 5)
    for (let p = 0; p < 2; p += 1) {
      classCenters.push(Float32Array.from(superCenter, (value) => value + randomNormal() * 2.5))
    }
  }

  // Per-point channels. `features` is the high-dimensional data the kNN
  // search runs on; everything else is what the graph renders.
  const features: Float32Array[] = []
  const classes: number[] = []
  const positions: number[] = []
  const colors: number[] = []
  const energies: number[] = []
  const links: number[] = []
  const linkStrengths: number[] = []
  // Adjacency (each point's kNN), for the stretched-springs distress check
  const knnNeighbors: number[][] = []

  const addPoint = (classIndex: number, x: number, y: number): void => {
    const center = classCenters[classIndex] as Float32Array
    features.push(Float32Array.from(center, (value) => value + randomNormal() * 1.2))
    classes.push(classIndex)
    positions.push(x, y)
    colors.push(...getRgbaColor(classColorScale(classIndex)))
    energies.push(1)
  }

  const squaredDistance = (a: Float32Array, b: Float32Array): number => {
    let sum = 0
    for (let d = 0; d < dims; d += 1) {
      const diff = (a[d] as number) - (b[d] as number)
      sum += diff * diff
    }
    return sum
  }

  // Attractive edges to the K nearest neighbors in feature space, with
  // Gaussian weights scaled by the point's own neighborhood radius —
  // t-SNE's perplexity calibration in spirit. Returns the neighbor indices.
  const wirePointByKnn = (pointIndex: number, count: number): number[] => {
    const feature = features[pointIndex] as Float32Array
    const neighbors: { index: number; dist2: number }[] = []
    for (let j = 0; j < count; j += 1) {
      if (j !== pointIndex) neighbors.push({ index: j, dist2: squaredDistance(feature, features[j] as Float32Array) })
    }
    neighbors.sort((a, b) => a.dist2 - b.dist2)
    const nearest = neighbors.slice(0, knnPerPoint)
    const kernelWidth2 = Math.max((nearest[nearest.length - 1] as { dist2: number }).dist2, 1e-6)
    for (const { index, dist2 } of nearest) {
      links.push(pointIndex, index)
      linkStrengths.push(Math.exp(-dist2 / kernelWidth2))
    }
    knnNeighbors[pointIndex] = nearest.map(({ index }) => index)
    return knnNeighbors[pointIndex] as number[]
  }

  for (let c = 0; c < nClasses; c += 1) {
    for (let i = 0; i < pointsPerClass; i += 1) {
      addPoint(c, spaceSize * (0.45 + 0.1 * Math.random()), spaceSize * (0.45 + 0.1 * Math.random()))
    }
  }
  for (let i = 0; i < features.length; i += 1) wirePointByKnn(i, features.length)

  const { div, graph, destroy } = createCosmos({
    pointPositions: new Float32Array(positions),
    pointColors: new Float32Array(colors),
    links: new Float32Array(links),
    // The two t-SNE terms: kNN springs and short-range Student-t repulsion
    // (which needs a stronger coefficient than the default 1/d kernel).
    // The rest length sets the intra-cluster spacing: the Student-t force
    // vanishes at zero distance, so with a tiny rest length the springs
    // would compress each class into a ball of overlapping points.
    simulationLinkDistance: linkDistance,
    simulationLinkSpring: 0.5,
    simulationRepulsionKernel: 'studentT',
    simulationRepulsion: 50,
    simulationGravity: 0.01,
    simulationCluster: 0,
    simulationEnergyDecay: energyDecay,
    simulationEnergyDiffusion: energyDiffusion,
    transitionDuration: 0,
    rescalePositions: false,
  })
  graph.setLinkStrength(new Float32Array(linkStrengths))
  graph.setPointEnergies(Float32Array.from(energies))
  graph.render()

  const meanLinkLength = (pointIndex: number, currentPositions: number[]): number => {
    const neighbors = knnNeighbors[pointIndex] as number[]
    let sum = 0
    for (const n of neighbors) {
      sum += Math.hypot(
        (currentPositions[pointIndex * 2] as number) - (currentPositions[n * 2] as number),
        (currentPositions[pointIndex * 2 + 1] as number) - (currentPositions[n * 2 + 1] as number)
      )
    }
    return sum / neighbors.length
  }

  // Halfway to white; the freeze pass restores the full class color
  const fadeColor = (index: number): void => {
    const [r, g, b] = getRgbaColor(classColorScale(classes[index] as number))
    colors.splice(index * 4, 4, r + (1 - r) * 0.5, g + (1 - g) * 0.5, b + (1 - b) * 0.5, 1)
  }

  // The energies evolve on the GPU (decay + diffusion); watch them to drive
  // the colors. A point the wake reaches is drawn faded; a point that
  // freezes gets its class color back — unless its springs are still
  // stretched (it froze far from its neighbors), in which case it stays
  // white as a distress flag.
  let previousEnergies = Float32Array.from(energies)
  const onTick = (): void => {
    const currentEnergies = graph.getPointEnergies()
    const frozen: number[] = []
    let anyWoken = false
    for (const [i, current] of currentEnergies.entries()) {
      const previous = previousEnergies[i] ?? 1 // newcomers arrive at full energy
      if (previous > 0 && current === 0) frozen.push(i)
      if (previous === 0 && current > 0) {
        fadeColor(i)
        anyWoken = true
      }
    }
    previousEnergies = currentEnergies
    if (frozen.length === 0 && !anyWoken) return
    if (frozen.length > 0) {
      const currentPositions = graph.getPointPositions()
      for (const i of frozen) {
        const settled = meanLinkLength(i, currentPositions) < distressedLinkLength
        colors.splice(i * 4, 4, ...(settled ? getRgbaColor(classColorScale(classes[i] as number)) : [1, 1, 1, 1]))
      }
    }
    graph.setPointColors(new Float32Array(colors))
    graph.render()
  }
  graph.setConfigPartial({ onSimulationTick: onTick })

  const addFreshPoints = (): void => {
    // Read the live coordinates and energies from the GPU so re-sending
    // them doesn't reset the layout or the energy schedule.
    const currentPositions = graph.getPointPositions()
    const currentEnergies = graph.getPointEnergies()
    const oldCount = currentPositions.length / 2
    positions.length = 0
    positions.push(...currentPositions)

    // Sample new points from random classes with full energy and wire each
    // to its nearest neighbors in feature space.
    for (let i = 0; i < freshCount; i += 1) {
      const pointIndex = oldCount + i
      const freshClass = Math.floor(Math.random() * nClasses)
      addPoint(freshClass, 0, 0) // placed below, once the neighbors are known
      colors.fill(1, pointIndex * 4, pointIndex * 4 + 4) // white until frozen
      const neighbors = wirePointByKnn(pointIndex, oldCount)

      // openTSNE-style placement: start at the mean of the neighbors'
      // current positions, with enough jitter to make the flight visible.
      let x = 0
      let y = 0
      for (const n of neighbors) {
        x += positions[n * 2] as number
        y += positions[n * 2 + 1] as number
      }
      positions[pointIndex * 2] = x / neighbors.length + randomNormal() * spaceSize * 0.04
      positions[pointIndex * 2 + 1] = y / neighbors.length + randomNormal() * spaceSize * 0.04
    }

    // Newcomers arrive at full energy; everyone else keeps whatever the GPU
    // schedule left them. The engine's diffusion wakes the neighborhoods.
    const newEnergies = new Float32Array(oldCount + freshCount).fill(1)
    newEnergies.set(currentEnergies.subarray(0, Math.min(oldCount, currentEnergies.length)))
    graph.setPointEnergies(newEnergies)
    graph.setPointPositions(new Float32Array(positions), true)
    graph.setPointColors(new Float32Array(colors))
    graph.setLinks(new Float32Array(links))
    graph.setLinkStrength(new Float32Array(linkStrengths))
    graph.render()
  }

  const button = document.createElement('button')
  button.textContent = `Insert ${freshCount} points into the frozen embedding`
  button.style.cssText = 'position: absolute; top: 16px; left: 16px; z-index: 1; padding: 8px 16px; font-size: 14px; cursor: pointer;'
  button.addEventListener('click', addFreshPoints)
  div.style.position = 'relative'
  div.appendChild(button)

  return { div, graph, destroy }
}
