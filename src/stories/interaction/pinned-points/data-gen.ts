// Note: This is vibe coding only - quick prototype code for demonstration purposes

function getRandom (min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function hslToRgb (hue: number, saturation: number, lightness: number): [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2

  let r, g, b
  if (hue >= 0 && hue < 60) {
    r = c; g = x; b = 0
  } else if (hue >= 60 && hue < 120) {
    r = x; g = c; b = 0
  } else if (hue >= 120 && hue < 180) {
    r = 0; g = c; b = x
  } else if (hue >= 180 && hue < 240) {
    r = 0; g = x; b = c
  } else if (hue >= 240 && hue < 300) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }

  return [r + m, g + m, b + m]
}

export function generateData (numNodes = 60): { pointPositions: Float32Array; links: Float32Array; pointColors: Float32Array } {
  const pointPositions = new Float32Array(numNodes * 2)
  const pointColors = new Float32Array(numNodes * 4)
  const linksArray: number[] = []

  const centerX = 2048
  const centerY = 2048
  const circleRadius = 900

  // First, place 6 nodes in a perfect circle with equal spacing
  const numCircleNodes = 6
  for (let i = 0; i < numCircleNodes; i++) {
    const angle = (i / numCircleNodes) * Math.PI * 2
    const x = centerX + Math.cos(angle) * circleRadius
    const y = centerY + Math.sin(angle) * circleRadius

    pointPositions[i * 2] = x
    pointPositions[i * 2 + 1] = y

    // Color based on position - rainbow gradient
    const hue = (i / numNodes) * 360
    const [r, g, b] = hslToRgb(hue, 0.7, 0.6)

    pointColors[i * 4] = r
    pointColors[i * 4 + 1] = g
    pointColors[i * 4 + 2] = b
    pointColors[i * 4 + 3] = 1.0
  }

  // Create remaining nodes in clusters around the space
  const numClusters = 4
  const remainingNodes = numNodes - numCircleNodes
  const nodesPerCluster = Math.floor(remainingNodes / numClusters)

  for (let cluster = 0; cluster < numClusters; cluster++) {
    const clusterAngle = (cluster / numClusters) * Math.PI * 2
    const clusterRadius = 1200
    const clusterX = centerX + Math.cos(clusterAngle) * clusterRadius
    const clusterY = centerY + Math.sin(clusterAngle) * clusterRadius

    const startIndex = numCircleNodes + cluster * nodesPerCluster
    const endIndex = cluster === numClusters - 1 ? numNodes : startIndex + nodesPerCluster

    for (let i = startIndex; i < endIndex; i++) {
      // Position nodes in a small cluster
      const angle = (i - startIndex) / (endIndex - startIndex) * Math.PI * 2
      const radius = 300 + getRandom(-50, 50)
      const x = clusterX + Math.cos(angle) * radius * getRandom(0.7, 1.3)
      const y = clusterY + Math.sin(angle) * radius * getRandom(0.7, 1.3)

      pointPositions[i * 2] = x
      pointPositions[i * 2 + 1] = y

      // Color based on position - rainbow gradient
      const hue = (i / numNodes) * 360
      const [r, g, b] = hslToRgb(hue, 0.7, 0.6)

      pointColors[i * 4] = r
      pointColors[i * 4 + 1] = g
      pointColors[i * 4 + 2] = b
      pointColors[i * 4 + 3] = 1.0
    }
  }

  // Create links: connect the 6 circle nodes to form a ring
  for (let i = 0; i < numCircleNodes; i++) {
    const nextIndex = (i + 1) % numCircleNodes
    linksArray.push(i)
    linksArray.push(nextIndex)
  }

  // Connect circle nodes to nearby cluster nodes - more connections
  for (let i = 0; i < numCircleNodes; i++) {
    const circleAngle = (i / numCircleNodes) * Math.PI * 2
    // Find nearest cluster and connect to many nodes in it
    const nearestCluster = Math.floor((circleAngle / (Math.PI * 2)) * numClusters) % numClusters
    const clusterStart = numCircleNodes + nearestCluster * nodesPerCluster
    const clusterEnd = nearestCluster === numClusters - 1 ? numNodes : clusterStart + nodesPerCluster
    // Connect to many nodes in the nearest cluster
    for (let j = clusterStart; j < Math.min(clusterStart + Math.floor(nodesPerCluster * 0.6), clusterEnd); j++) {
      linksArray.push(i)
      linksArray.push(j)
    }
    // Also connect to some nodes in adjacent clusters
    const nextCluster = (nearestCluster + 1) % numClusters
    const nextClusterStart = numCircleNodes + nextCluster * nodesPerCluster
    const nextClusterEnd = nextCluster === numClusters - 1 ? numNodes : nextClusterStart + nodesPerCluster
    for (let j = nextClusterStart; j < Math.min(nextClusterStart + Math.floor(nodesPerCluster * 0.3), nextClusterEnd); j++) {
      linksArray.push(i)
      linksArray.push(j)
    }
  }

  // Connect nodes within clusters and some cross-cluster links
  for (let i = numCircleNodes; i < numNodes; i++) {
    const cluster = Math.floor((i - numCircleNodes) / nodesPerCluster)
    const clusterStart = numCircleNodes + cluster * nodesPerCluster
    const clusterEnd = cluster === numClusters - 1 ? numNodes : clusterStart + nodesPerCluster

    // Connect to nearby nodes in the same cluster
    for (let j = clusterStart; j < clusterEnd; j++) {
      if (i !== j && Math.abs(i - j) <= 3) {
        linksArray.push(i)
        linksArray.push(j)
      }
    }

    // Connect to nodes in adjacent clusters (sparse connections)
    if (i % 3 === 0) {
      const nextCluster = (cluster + 1) % numClusters
      const nextClusterStart = numCircleNodes + nextCluster * nodesPerCluster
      const nextClusterEnd = nextCluster === numClusters - 1 ? numNodes : nextClusterStart + nodesPerCluster
      const targetIndex = nextClusterStart + Math.floor(((i - clusterStart) % nodesPerCluster) * (nextClusterEnd - nextClusterStart) / nodesPerCluster)
      if (targetIndex < numNodes && targetIndex >= numCircleNodes) {
        linksArray.push(i)
        linksArray.push(targetIndex)
      }
    }
  }

  const links = new Float32Array(linksArray)

  return { pointPositions, links, pointColors }
}
