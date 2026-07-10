import type { ShaderModule } from '@luma.gl/shadertools'

/**
 * Shared GLSL helpers for 3D (`SPACE_3D`) vertex shaders.
 *
 * `focalNdc` extracts the projection focal length (`P[1][1] = 1 / tan(fovY / 2)`) from the
 * combined view-projection matrix: for `VP = P * V` with a rigid view matrix (rotation +
 * translation only — guaranteed by the orbit camera), the length of the second row of the
 * upper-left 3x3 equals `P[1][1]`.
 *
 * `pxPerSpaceUnit` converts that to pixels per space unit at clip-space depth `w` — the 3D
 * analog of the 2D zoom factor `transformationMatrix[0][0]`, so the `scalePointsOnZoom` /
 * `scaleLinksOnZoom` size semantics carry over unchanged.
 *
 * `cameraForward` extracts the camera's unit view direction in space coordinates: for a
 * standard perspective projection (bottom row `(0, 0, -1, 0)` — guaranteed by
 * `mat4.perspective`) the w row of `VP` equals the negated third row of the rigid view
 * matrix, i.e. clip `w` grows linearly along the view direction, so the w row's xyz is that
 * direction itself.
 */
const space3dVS = /* glsl */ `
float focalNdc(mat4 m) {
  return length(vec3(m[0][1], m[1][1], m[2][1]));
}

float pxPerSpaceUnit(mat4 viewProjection, vec2 screen, float w) {
  return 0.5 * screen.y * focalNdc(viewProjection) / w;
}

vec3 cameraForward(mat4 viewProjection) {
  return vec3(viewProjection[0][3], viewProjection[1][3], viewProjection[2][3]);
}
`

export const space3dModule: ShaderModule = {
  name: 'space3d',
  vs: space3dVS,
}
