import { scaleLinear, scaleSequential } from 'd3-scale'
import { interpolateWarm } from 'd3-scale-chromatic'
import { getRgbaColor, defaultConfigValues } from '@cosmos.gl/graph'

function getRandom (min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function getPositionOnCircle (radius: number, angle: number, center: number): [number, number] {
  const x = center + radius * Math.cos(angle)
  const y = center + radius * Math.sin(angle)
  return [x, y]
}

export type MeshData = {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointSizes: Float32Array;

  links: Float32Array;
  linkColors: Float32Array;
  linkWidths: Float32Array;
  // linkStrength: Float32Array;

  pointClusters: number[];
  clusterPositions: number[];
  clusterStrength: Float32Array;
}

export function generateMeshData (
  n: number,
  m: number,
  nClusters: number,
  wholeness: number,
  radialness = [10, 1000]
): MeshData {
  const pointColorScale = scaleSequential(interpolateWarm)
  pointColorScale.domain([0, nClusters])
  const radius = scaleLinear(radialness)
  radius.domain([0, nClusters])

  const pointPositions = new Float32Array(n * m * 2)
  const links: number[] = []
  const pointClusters = new Array(n * m)
  const clusterPositions = new Array(nClusters * 2)
  const clusterStrength = new Float32Array(n * m)
  const pointColors = new Float32Array(n * m * 4)
  const pointSizes = new Float32Array(n * m)

  const spaceSize = defaultConfigValues.spaceSize

  for (let clusterIndex = 0; clusterIndex < nClusters; clusterIndex += 1) {
    const [x, y] = getPositionOnCircle(radius(clusterIndex), 15 * Math.PI * (clusterIndex / nClusters), spaceSize / 2)
    clusterPositions[clusterIndex * 2] = x
    clusterPositions[clusterIndex * 2 + 1] = y
  }

  for (let pointIndex = 0; pointIndex < n * m; pointIndex += 1) {
    const x = spaceSize * getRandom(0.495, 0.505)
    const y = spaceSize * getRandom(0.495, 0.505)
    pointPositions[pointIndex * 2] = x
    pointPositions[pointIndex * 2 + 1] = y

    pointClusters[pointIndex] = pointIndex % nClusters
    clusterStrength[pointIndex] = (nClusters - (pointIndex % nClusters)) / nClusters
    const pointColor = pointColorScale(pointIndex % nClusters)
    const rgba = getRgbaColor(pointColor)
    pointColors[pointIndex * 4] = rgba[0]
    pointColors[pointIndex * 4 + 1] = rgba[1]
    pointColors[pointIndex * 4 + 2] = rgba[2]
    pointColors[pointIndex * 4 + 3] = rgba[3]

    pointSizes[pointIndex] = getRandom(1, 5)

    const nextPointIndex = pointIndex + 1
    const bottomPointIndex = pointIndex + n
    const pointLine = Math.floor(pointIndex / n)
    const nextPointLine = Math.floor(nextPointIndex / n)
    const bottomPointLine = Math.floor(bottomPointIndex / n)

    if (pointLine === nextPointLine && Math.random() < wholeness) {
      links.push(pointIndex)
      links.push(nextPointIndex)
    }

    if (bottomPointLine < m && Math.random() < wholeness) {
      links.push(pointIndex)
      links.push(bottomPointIndex)
    }
  }

  const linkColors = new Float32Array(links.length / 2 * 4)
  const linkWidths = new Float32Array(links.length / 2)
  // const linkStrength = new Float32Array(links.length / 2)
  for (let i = 0; i < links.length / 2; i++) {
    const sourcePointIndex = links[i * 2] as number
    const rgba = getRgbaColor(pointColorScale(sourcePointIndex % nClusters))
    linkColors[i * 4 + 0] = rgba[0]
    linkColors[i * 4 + 1] = rgba[1]
    linkColors[i * 4 + 2] = rgba[2]
    linkColors[i * 4 + 3] = 0.9

    linkWidths[i] = getRandom(0.4, 0.8)
    // linkStrength[i] = (n * m - sourcePointIndex) / (n * m)
  }

  return {
    pointPositions,
    pointColors,
    pointSizes,

    links: new Float32Array(links),
    linkColors,
    linkWidths,
    // linkStrength,

    pointClusters,
    clusterStrength,
    clusterPositions,
  }
}
