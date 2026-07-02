export type GalaxyGraphData3D = {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  links: Float32Array;
}

/**
 * Gaussian-ish random value in [-1, 1] (average of three uniforms, centered).
 */
const randomSpread = (): number => (Math.random() + Math.random() + Math.random()) / 1.5 - 1

/**
 * Generates a spiral-galaxy point cloud: a spherical core bulge plus logarithmic
 * spiral arms in a thin disc. Points are chained along each arm with links.
 * Designed as a rendering-performance stress test (~100k points).
 */
export function generateGalaxy3D (pointsNumber = 100000, spaceSize = 4096): GalaxyGraphData3D {
  const pointPositions = new Float32Array(pointsNumber * 3)
  const pointColors = new Float32Array(pointsNumber * 4)
  const links: number[] = []

  const center = spaceSize / 2
  const armsNumber = 3
  const bulgeShare = 0.2
  const bulgePointsNumber = Math.floor(pointsNumber * bulgeShare)
  const bulgeRadius = spaceSize * 0.07
  const discRadius = spaceSize * 0.45
  const discThickness = spaceSize * 0.015
  const previousPointOfArm: number[] = new Array(armsNumber).fill(-1)

  for (let i = 0; i < pointsNumber; i += 1) {
    let radius: number
    if (i < bulgePointsNumber) {
      // Core bulge: spherical Gaussian blob.
      const x = randomSpread() * bulgeRadius
      const y = randomSpread() * bulgeRadius
      const z = randomSpread() * bulgeRadius
      pointPositions[i * 3 + 0] = center + x
      pointPositions[i * 3 + 1] = center + y
      pointPositions[i * 3 + 2] = center + z
      radius = Math.sqrt(x * x + y * y + z * z)
    } else {
      // Spiral arms: logarithmic spiral in the xy plane with a thin Gaussian disc in z.
      // t grows monotonically along each arm so the chain links follow the spiral.
      const arm = i % armsNumber
      const armPointsNumber = Math.ceil((pointsNumber - bulgePointsNumber) / armsNumber)
      const t = Math.floor((i - bulgePointsNumber) / armsNumber) / armPointsNumber
      radius = bulgeRadius * 0.5 + (discRadius - bulgeRadius * 0.5) * t
      const angle = (arm / armsNumber) * Math.PI * 2 + t * Math.PI * 2.5
      const scatter = (0.05 + 0.2 * t) * radius
      pointPositions[i * 3 + 0] = center + radius * Math.cos(angle) + randomSpread() * scatter
      pointPositions[i * 3 + 1] = center + radius * Math.sin(angle) + randomSpread() * scatter
      pointPositions[i * 3 + 2] = center + randomSpread() * (discThickness + scatter * 0.15)

      // Chain arm points into a filament so link rendering is stressed too.
      const previous = previousPointOfArm[arm] as number
      if (previous >= 0) links.push(i, previous)
      previousPointOfArm[arm] = i
    }

    // Color by distance from the core: warm center fading into cool arms.
    const warmth = Math.max(0, 1 - radius / discRadius)
    pointColors[i * 4 + 0] = 0.45 + 0.55 * warmth
    pointColors[i * 4 + 1] = 0.35 + 0.45 * warmth
    pointColors[i * 4 + 2] = 0.75 + 0.15 * (1 - warmth)
    pointColors[i * 4 + 3] = 0.85
  }

  return { pointPositions, pointColors, links: new Float32Array(links) }
}
