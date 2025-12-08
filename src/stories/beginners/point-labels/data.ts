function getRandom (min: number, max: number): number {
  return Math.random() * (max - min) + min
}

export const pointsToShowLabelsFor = [
  'Drury Lane Theatre',
  "King's Theatre",
  "Lincoln's Inn Fields",
  "Goodman's Fields",
  'Haymarket Theatre',
  'Covent Garden',
  'Bartholomew Fair',
  'Southwark Fair',
  'Pantheon, Oxford Street',
]

export const processPerformances = (performances: {
  theaterCode: string;
  performanceTitle: string;
  theaterName: string;
}[]): { pointPositions: Float32Array; pointColors: Float32Array; pointSizes: Float32Array; pointLabelToIndex: Map<string, number>; pointIndexToLabel: Map<number, string>; links: Float32Array } => {
  const pointLabelToIndex = new Map<string, number>()
  const pointIndexToLabel = new Map<number, string>()
  const pointPositions: number[] = []
  const pointColors: number[] = []
  const pointSizes: number[] = []

  Array.from(
    new Set([
      ...performances.map((p) => `P:${p.performanceTitle}`),
      ...performances.map((p) => p.theaterName),
    ])
  ).forEach((point, index) => {
    pointLabelToIndex.set(point, index)
    pointIndexToLabel.set(index, point)
    pointPositions.push(4096 * getRandom(0.495, 0.505)) // x
    pointPositions.push(4096 * getRandom(0.495, 0.505)) // y
    if (point.indexOf('P:') === 0) {
    // #4B5BBF
      pointColors.push(75 / 256) // r
      pointColors.push(91 / 256) // g
      pointColors.push(191 / 256) // b
      pointColors.push(1) // a
    } else {
    // #ED69B4
      pointColors.push(237 / 256) // r
      pointColors.push(105 / 256) // g
      pointColors.push(180 / 256) // b
      pointColors.push(1) // a
    }
    pointSizes.push(pointsToShowLabelsFor.includes(point) ? 50 : 15)
  })

  const links = performances
    .map((p) => {
      const theaterIndex = pointLabelToIndex.get(p.theaterName)
      const performanceIndex = pointLabelToIndex.get(`P:${p.performanceTitle}`)
      if (theaterIndex === undefined || performanceIndex === undefined) {
        return []
      }
      return [theaterIndex, performanceIndex]
    })
    .flat()

  return {
    pointPositions: new Float32Array(pointPositions),
    pointColors: new Float32Array(pointColors),
    pointSizes: new Float32Array(pointSizes),
    pointLabelToIndex,
    pointIndexToLabel,
    links: new Float32Array(links),
  }
}
