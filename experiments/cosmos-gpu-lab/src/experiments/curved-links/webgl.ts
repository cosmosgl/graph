import { createLinksWebGL } from '../straight-links/webgl'
import { productionGeometry } from './geometry'
import type { Settings } from './data'
import type { Backend } from './backend'
export async function createCurvesWebGL (canvas: HTMLCanvasElement): Promise<Backend> {
  return await createLinksWebGL(canvas, settings => {
    const curve = settings as Settings
    return { positions: productionGeometry(curve), segments: curve.segments, weight: curve.weight, distance: curve.controlDistance }
  })
}
