import { getCurveLineGeometry } from '../../../../../src/modules/Lines/geometry'
import { validateCurve, type Settings } from './data'
// Both GPU paths consume the actual production geometry, including its signed
// power-spaced t attributes. The scalar reference reconstructs it independently.
export function productionGeometry (settings: Settings): Float32Array {
  validateCurve(settings); return new Float32Array(getCurveLineGeometry(settings.segments).flat())
}
