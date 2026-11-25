// WebGL point coordinates measured on Apple M3. The rasterizer sets up a plane
// at the corner of each 32-device-pixel tile and samples it at pixel centers.
// Both sprite extents affect its constant term, even for an axis-aligned sprite.
// The measured setup carries extra significand bits before storing its f32
// coefficients. A high value and a residual let WGSL retain those guard bits.
fn guardStep(value: f32, extraBits: u32) -> f32 {
  let shift = 23u + extraBits;
  let exponent = max(bitcast<u32>(abs(value)) >> 23u, shift + 1u);
  return bitcast<f32>((exponent - shift) << 23u);
}

fn tileSlope(span: vec2f) -> vec4f {
  let area = span.x * span.y;
  let inverse = 1.0 / area;
  let residual = fma(-inverse, area, 1.0) / area;
  let areaStep = guardStep(inverse, 1u);
  let inverseLow = round(residual / areaStep) * areaStep;

  let high = span.yx * inverse;
  let error = fma(span.yx, vec2f(inverse), -high) + span.yx * inverseLow;
  let slopeStep = vec2f(guardStep(high.x, 5u), guardStep(high.y, 5u));
  return vec4f(high, ceil(error / slopeStep) * slopeStep);
}

fn tileCoefficient(offset: vec2f, slope: vec4f) -> vec2f {
  let high = offset * slope.xy;
  let error = fma(offset, slope.xy, -high) + offset * slope.zw;
  // When the sprite begins on this tile the coefficient is exactly zero on that
  // axis. A unit rounding step keeps it zero: halving guardStep(0) can flush
  // to zero on Metal, and the resulting 0/0 corrupts the shape distance.
  let step28 = select(vec2f(guardStep(high.x, 4u), guardStep(high.y, 4u)), vec2f(1), offset == vec2f(0));
  let step29 = step28 * 0.5;
  let guarded = round(error / step29) * step29;
  return high + round(guarded / step28) * step28;
}

// The native interpolator truncates its multiply-add towards zero. Recover the
// rounding error with FastTwoSum on (nearest - base), then move one f32 toward
// zero only when nearest overshot. Explicit fma preserves each rounding step.
fn samplePointPlane(offset: f32, gradient: f32, base: f32) -> f32 {
  let nearest = fma(offset, gradient, base);
  let orderByMagnitude = abs(nearest) >= abs(base);
  let larger = select(-base, nearest, orderByMagnitude);
  let smaller = select(nearest, -base, orderByMagnitude);
  let difference = nearest - base;
  let differenceError = fma(-1.0, fma(-1.0, larger, difference), smaller);
  let residual = fma(offset, gradient, -difference) - differenceError;
  let overshot = residual * nearest < 0.0;
  return bitcast<f32>(bitcast<u32>(nearest) - u32(overshot));
}

fn applePointCoordinates(pixel: vec2f, origin: vec2f, gradient: vec2f, slope: vec4f) -> vec2f {
  let tile = floor(pixel / 32.0) * 32.0;
  let offset = pixel - tile;
  let base = tileCoefficient(tile - origin, slope);
  let pointUV = vec2f(samplePointPlane(offset.x, gradient.x, base.x),
                      samplePointPlane(offset.y, gradient.y, base.y));
  // ANGLE orients Metal point coordinates around the center of the sprite.
  return fma(pointUV - vec2f(0.5), vec2f(1, -1), vec2f(0.5));
}
