import { pick } from '../../gpu/rgba-readback'
import type { CheckResult } from '../../runtime/live-checks'
import type { Backend } from './backend'
import { DEFAULTS, type Scene } from './data'
import { colorOutsideBudget, cpuColors, outlineDistance, ribbons, scalarPick } from './reference'

// This diagonal has pixel centers on its butt caps. The geometric distance also
// handles pixels beyond both a side and a cap (distance to the nearest corner).
const scene: Scene = {
  points: [{ x: 324, y: 65 }, { x: 460, y: 201 }],
  links: [{ source: 0, target: 1, width: 8, color: [0.25, 0.55, 0.85, 0.65] }],
}

export async function checkRibbon (gl: Backend, gpu: Backend, blend: boolean, signal?: AbortSignal): Promise<CheckResult> {
  const settings = { ...DEFAULTS, blend }
  const a = await gl.render(scene, settings, 'visible', false)
  signal?.throwIfAborted()
  const b = await gpu.render(scene, settings, 'visible', false)
  const colors = cpuColors(scene, settings)
  const geometry = ribbons(scene, settings, false, 'visible')
  const [r] = geometry
  const referencePick = scalarPick(geometry, settings, 'visible')
  let edgeDifferences = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const distance = outlineDistance(r, x + 0.5, y + 0.5)
      const boundary = Math.abs(distance) <= 1
      const expectedId = boundary ? referencePick(x + 0.5, y + 0.5) : distance <= 0 ? 0 : null
      const offset = (y * a.width + x) * 4
      const glId = pick(a, x, y)
      const gpuId = pick(b, x, y)
      if ((glId !== null && (glId !== 0 || a.color[offset + 3] === 0)) ||
          (gpuId !== null && (gpuId !== 0 || b.color[offset + 3] === 0))) {
        return { status: 'failed', detail: `Picked an invisible or unknown link at (${x}, ${y}).` }
      }
      const mismatch = glId !== expectedId || gpuId !== expectedId || colorOutsideBudget(a.color, b.color, colors, offset)
      if (!boundary && mismatch) {
        return { status: 'failed', detail: `Color or picked ID differs outside the edge band at (${x}, ${y}).` }
      }
      if (boundary && mismatch) edgeDifferences++
    }
  }
  return { status: 'passed', detail: `Pixels with differences in the one-device-pixel edge band: ${edgeDifferences}.` }
}
