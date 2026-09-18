import { Graph, getRgbaColor } from '@cosmos.gl/graph'
import { interpolateSinebow } from 'd3-scale-chromatic'
import { createCosmos } from '../create-cosmos'

/**
 * Attractors: every point is pulled toward a target position of its own, as one
 * force among the others — links still pull neighbours together and repulsion
 * still keeps points apart, so the result is a *soft* constraint.
 *
 * The points are chained by links in order (a closed loop for closed curves), and
 * their attractors are sampled along a parametric curve, so the attractor force
 * draws the shape and the links trace it. Every fifth point has no attractor
 * (`NaN`, drawn dimmer): it is placed only by its two chain links and settles
 * between its neighbours, which is what makes the constraint soft.
 *
 * Gravity pulls every point toward the centre of the space, so the attractors
 * have something to resist: with the default loose strength the figure settles
 * visibly shrunken toward the centre, and switching to firm lets the attractors
 * win and the figure expands to its true size. Turn gravity off to see the
 * shape with nothing fighting it. Hold the right mouse button near the curve to
 * push points away and watch the attractors pull them back.
 */
export const attractors = (): { graph: Graph; div: HTMLDivElement; destroy: () => void } => {
  const numPoints = 400
  const spaceSize = 4096
  const center = spaceSize / 2
  const radius = 1400 // every shape fits inside this radius around the centre

  // Deterministic pseudo-random numbers (mulberry32) so the scene is reproducible
  let seed = 11
  const random = (): number => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Start every point in a small pile at the centre, so the shape visibly blooms
  // out of it instead of the scene starting already resolved.
  const pointPositions = new Float32Array(numPoints * 2)
  for (let i = 0; i < numPoints; i++) {
    pointPositions[i * 2] = center + (random() - 0.5) * 200
    pointPositions[i * 2 + 1] = center + (random() - 0.5) * 200
  }

  // Parametric curves, t ∈ [0, 1), returning a point in space coordinates.
  type Curve = { name: string; closed: boolean; at: (t: number) => [number, number] }
  const polar = (r: number, angle: number): [number, number] =>
    [center + r * Math.cos(angle), center + r * Math.sin(angle)]

  const heart: Curve = {
    name: 'Heart',
    closed: true,
    at: (t) => {
      const a = t * Math.PI * 2
      // The classic heart curve spans x ∈ [-16, 16], y ∈ [-17, 13]; scale it to the radius.
      const x = 16 * Math.sin(a) ** 3
      const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)
      const s = radius / 17
      return [center + x * s, center + y * s]
    },
  }
  const spiral: Curve = {
    name: 'Spiral',
    closed: false,
    at: (t) => polar(radius * (0.08 + 0.92 * t), t * Math.PI * 2 * 3.5),
  }
  const rose: Curve = {
    name: 'Rose',
    closed: true,
    // r = cos(kθ) with odd k = 5 closes after θ ∈ [0, π) and draws five petals.
    at: (t) => polar(radius * Math.cos(5 * t * Math.PI), t * Math.PI),
  }
  const lissajous: Curve = {
    name: 'Lissajous',
    closed: true,
    at: (t) => [
      center + radius * Math.sin(3 * t * Math.PI * 2 + Math.PI / 2),
      center + radius * Math.sin(2 * t * Math.PI * 2),
    ],
  }
  const star: Curve = {
    name: 'Star',
    closed: true,
    at: (t) => {
      // Ten straight segments alternating between outer and inner vertices.
      const segments = 10
      const u = t * segments
      const k = Math.floor(u)
      const f = u - k
      const vertex = (n: number): [number, number] =>
        polar(n % 2 === 0 ? radius : radius * 0.42, -Math.PI / 2 + (n / segments) * Math.PI * 2)
      const [x0, y0] = vertex(k)
      const [x1, y1] = vertex(k + 1)
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]
    },
  }
  const infinity: Curve = {
    name: 'Infinity',
    closed: true,
    at: (t) => {
      // Lemniscate of Bernoulli, widened to fill the radius horizontally.
      const a = t * Math.PI * 2
      const d = 1 + Math.sin(a) ** 2
      return [center + radius * Math.cos(a) / d, center + radius * 0.9 * Math.sin(a) * Math.cos(a) / d]
    },
  }
  const curves = [heart, spiral, rose, lissajous, star, infinity]

  // Points are chained in order, so the links trace the curve. Closed curves get
  // the closing link too, so the loop has no loose ends.
  const buildLinks = (curve: Curve): Float32Array => {
    const count = curve.closed ? numPoints : numPoints - 1
    const links = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      links[i * 2] = i
      links[i * 2 + 1] = (i + 1) % numPoints
    }
    return links
  }

  // Every fifth point is free: no attractor, placed by its chain links alone.
  const isFree = (i: number): boolean => i % 5 === 4

  const buildAttractors = (curve: Curve): Float32Array => {
    const targets = new Float32Array(numPoints * 2).fill(NaN)
    for (let i = 0; i < numPoints; i++) {
      if (isFree(i)) continue
      const [x, y] = curve.at(i / numPoints)
      targets[i * 2] = x
      targets[i * 2 + 1] = y
    }
    return targets
  }

  const looseStrength = new Float32Array(numPoints).fill(0.15)
  const firmStrength = new Float32Array(numPoints).fill(1)
  // Strong enough that the loose figure settles visibly smaller than its attractors
  // draw it, gentle enough that it keeps its shape and the free points only dip inward.
  const gravityOn = 0.25

  // Hue runs along the curve; free points are the same hue, slightly faded.
  const pointColors = new Float32Array(numPoints * 4)
  for (let i = 0; i < numPoints; i++) {
    const rgba = getRgbaColor(interpolateSinebow(i / numPoints))
    pointColors[i * 4] = rgba[0]
    pointColors[i * 4 + 1] = rgba[1]
    pointColors[i * 4 + 2] = rgba[2]
    pointColors[i * 4 + 3] = isFree(i) ? 0.55 : 1
  }
  // Links take the hue of their source point; the chain reads as a coloured ribbon.
  const buildLinkColors = (links: Float32Array): Float32Array => {
    const count = links.length / 2
    const colors = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      const source = links[i * 2] as number
      colors[i * 4] = pointColors[source * 4] as number
      colors[i * 4 + 1] = pointColors[source * 4 + 1] as number
      colors[i * 4 + 2] = pointColors[source * 4 + 2] as number
      colors[i * 4 + 3] = 0.7
    }
    return colors
  }

  const initialCurve = heart
  const initialLinks = buildLinks(initialCurve)

  const { div, graph } = createCosmos({
    pointPositions,
    pointColors,
    links: initialLinks,
    linkColors: buildLinkColors(initialLinks),
    pointAttractors: buildAttractors(initialCurve),
    pointAttractorStrength: looseStrength,
    spaceSize,
    pointDefaultSize: 18,
    linkDefaultWidth: 1.5,
    curvedLinks: false,
    simulationAttraction: 0.6,
    // The rest length matches the spacing of the attractors along the curve, with no
    // randomness, so the chain neither pulls the figure taut nor bunches it up and the
    // free points settle centred between their neighbours.
    simulationLinkSpring: 0.8,
    simulationLinkDistance: 20,
    simulationLinkDistRandomVariationRange: [1, 1],
    // A little repulsion spreads points evenly along the curve.
    simulationRepulsion: 0.3,
    // Gravity is the force the attractors resist — see the story description.
    simulationGravity: gravityOn,
    // Right-click repulsion lets you poke the curve and watch it recover.
    enableRightClickRepulsion: true,
    simulationRepulsionFromMouse: 4,
    simulationFriction: 0.85,
    simulationDecay: 3000,
    fitViewOnInit: false,
  })
  div.style.position = 'relative'

  // Every shape is centred in the space and fits inside `radius`, so one zoom frames
  // them all. Computed once the story's div is in the page (so it has a size), as an
  // immediate zoom rather than a fit-view transition — the points start in a pile and
  // fitting to them would frame the pile.
  const fitTimer = setTimeout(() => {
    const side = Math.min(div.clientWidth, div.clientHeight)
    if (side > 0) graph.zoom((side * 0.85) / (radius * 2))
  }, 300)

  const buttonStyle = (top: number): string => [
    'position: absolute',
    `top: ${top}px`,
    'left: 12px',
    'z-index: 1000',
    'padding: 6px 16px',
    'font: 600 13px Helvetica, Arial, sans-serif',
    'color: #fff',
    'background: #5f69de',
    'border: none',
    'border-radius: 15px',
    'cursor: pointer',
    'opacity: 0.9',
  ].join(';')

  let curveIndex = 0
  const shapeButton = document.createElement('button')
  shapeButton.style.cssText = buttonStyle(12)
  shapeButton.textContent = `Shape: ${initialCurve.name}`
  shapeButton.addEventListener('click', () => {
    curveIndex = (curveIndex + 1) % curves.length
    const curve = curves[curveIndex]
    if (!curve) return
    shapeButton.textContent = `Shape: ${curve.name}`
    const links = buildLinks(curve)
    graph.setLinks(links)
    graph.setLinkColors(buildLinkColors(links))
    graph.setPointAttractors(buildAttractors(curve))
    // render() applies the new data but never starts or stops the simulation; the
    // layout has usually settled by now, so reheat it to travel to the new shape.
    graph.render()
    graph.start(1)
  })
  div.appendChild(shapeButton)

  let firm = false
  const strengthLabel = (): string => firm ? 'Attractor strength: firm (1)' : 'Attractor strength: loose (0.15)'
  const strengthButton = document.createElement('button')
  strengthButton.style.cssText = buttonStyle(48)
  strengthButton.textContent = strengthLabel()
  strengthButton.addEventListener('click', () => {
    firm = !firm
    strengthButton.textContent = strengthLabel()
    graph.setPointAttractorStrength(firm ? firmStrength : looseStrength)
    graph.render()
    graph.start(1)
  })
  div.appendChild(strengthButton)

  let gravity = true
  const gravityLabel = (): string => gravity ? `Gravity: on (${gravityOn})` : 'Gravity: off'
  const gravityButton = document.createElement('button')
  gravityButton.style.cssText = buttonStyle(84)
  gravityButton.textContent = gravityLabel()
  gravityButton.addEventListener('click', () => {
    gravity = !gravity
    gravityButton.textContent = gravityLabel()
    graph.setConfig({ simulationGravity: gravity ? gravityOn : 0 })
    graph.start(1)
  })
  div.appendChild(gravityButton)

  return { div, graph, destroy: (): void => clearTimeout(fitTimer) }
}
