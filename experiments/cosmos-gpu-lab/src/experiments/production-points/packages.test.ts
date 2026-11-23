import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { shapeDistance } from '../point-styling/reference'
import { comparePoints } from './compare'
import { fractionalDiameters, pointBackground, pointCell, pointFill, pointSamples, pointsViewport } from './fixture'
import { mountPoints, type PointsSession } from './frame'

// Check the intended silhouette independently of the paired RGBA comparison. Only this
// geometry check excludes the one-device-pixel band where antialiasing mixes the colors.
function checkShapes (image: ImageData, ratio: 1 | 2, diameter: number): void {
  for (const point of pointSamples(diameter)) {
    const radius = point.diameter * ratio / 2
    const left = point.column * pointCell.width * ratio
    const top = point.row * pointCell.height * ratio
    let wrong = 0
    for (let y = top; y < top + pointCell.height * ratio; y++) {
      for (let x = left; x < left + pointCell.width * ratio; x++) {
        const distance = radius * shapeDistance((x + 0.5 - point.x * ratio) / radius, (y + 0.5 - point.y * ratio) / radius, point.column)
        if (Math.abs(distance) <= 1) continue
        const color = distance < 0 ? pointFill : pointBackground
        const i = (y * image.width + x) * 4
        if (image.data[i + 3] !== 255 || color.some((channel, j) => image.data[i + j] !== channel)) wrong++
      }
    }
    expect(wrong, `${point.shape}, row ${point.row + 1}: unexpected fill or background away from the edge`).toBe(0)
  }
}

for (const ratio of [1, 2] as const) {
  it.each(fractionalDiameters)(`compares the packaged point shapes at ${ratio}× with fractional diameter %s`, async diameter => {
    const frames: HTMLIFrameElement[] = []
    const sessions: PointsSession[] = []
    try {
      for (const engine of ['webgl', 'webgpu'] as const) {
        const frame = document.createElement('iframe')
        frames.push(frame)
        frame.width = String(pointsViewport.width)
        frame.height = String(pointsViewport.height)
        document.body.append(frame)
        const doc = frame.contentDocument!
        doc.body.style.margin = '0'
        const host = doc.createElement('div')
        host.style.cssText = 'position:relative;width:100vw;height:100vh'
        doc.body.append(host)
        sessions.push(await mountPoints(host, engine, ratio, diameter))
      }
      const [gl, gpu] = await Promise.all(sessions.map(session => session.snapshot()))
      const comparison = comparePoints(gl, gpu, ratio)
      await writeArtifact(`package-points-${ratio}x-${String(diameter).replace('.', '-')}`, {
        ratio, diameter, exact: comparison.differingPixels === 0, ...comparison,
      })
      for (const image of [gl, gpu]) checkShapes(image, ratio, diameter)
      for (const counts of comparison.byShape) {
        // The 22 CSS pixel control matches at the integer and fractional center.
        expect([counts[0], counts[2]]).toEqual([0, 0])
      }
      expect(comparison.differingPixels, `different RGBA pixels at ${diameter} CSS px and ${ratio}×`).toBe(0)
    } finally {
      for (const session of sessions) session.destroy()
      for (const frame of frames) frame.remove()
    }
  })
}
