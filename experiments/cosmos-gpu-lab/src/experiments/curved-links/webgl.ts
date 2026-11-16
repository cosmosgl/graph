import { createLinksWebGL } from '../straight-links/webgl'
import { productionGeometry } from './geometry'
import type { Settings } from './data'
import type { Backend, Snapshot } from './backend'
export async function createCurvesWebGL (canvas: HTMLCanvasElement): Promise<Backend> {
  const backend = await createLinksWebGL(canvas, settings => {
    const curve = settings as Settings & { frontPicking?: boolean }
    return {
      positions: productionGeometry(curve),
      segments: curve.segments,
      weight: curve.weight,
      distance: curve.controlDistance,
      frontPicking: curve.frontPicking,
    }
  })
  return {
    info: backend.info,
    async render (scene, settings, variant, display, diagnose): Promise<Snapshot> {
      const input = { ...settings, frontPicking: variant === 'front' }
      const image = await backend.render(scene, input, variant === 'production' ? 'production' : 'visible', display, diagnose)
      return { ...image, variant, probe: image.probe?.vertices ? { varying: image.probe.varying, vertices: image.probe.vertices } : undefined }
    },
    destroy: (): void => { backend.destroy() },
  }
}
