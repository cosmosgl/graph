// A point's size in device pixels: the size (CSS px) by the pixel ratio and the zoom — 1:1 with
// scalePointsOnZoom, otherwise held near constant — capped at the hardware sprite limit.
// pxPerUnit is the zoom scale. Module code precedes each shader's own uniforms, so they come in
// as parameters.
float pointSizePx(float size, float ratio, float pxPerUnit, float scalePointsOnZoom, float maxPointSize) {
  float zoom = scalePointsOnZoom > 0.0 ? pxPerUnit : min(5.0, max(1.0, pxPerUnit * 0.01));
  return min(size * ratio * zoom, maxPointSize * ratio);
}
