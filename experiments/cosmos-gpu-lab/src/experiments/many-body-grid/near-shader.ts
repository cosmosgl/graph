import roundedProduct from '../../gpu/rounded-product.wgsl?raw'
import roundedSquare from './rounded-square.wgsl?raw'
import arithmetic from './far-arithmetic.wgsl?raw'
import { replaceOnce } from './trace'

// Shared with the production-routing exact kernel. Keep the scalar evaluation
// order: softened magnitude, separately divided direction, rounded product.
export function refinedPairShader (source: string): string {
  if (!source.includes('fn refinedDivide(')) source += roundedSquare + arithmetic
  source += roundedProduct
  return `${source}
fn nearPairVelocity(delta: vec2<f32>, randomDir: vec2<f32>) -> vec2<f32> {
  var d = delta;
  if (roundedSquare(d.x) + roundedSquare(d.y) <= 0.) { d = randomDir; }
  let squared = roundedSquare(d.x) + roundedSquare(d.y);
  if (squared <= 0.) { return vec2(0.); }
  let root = refinedRoot(squared);
  var denominator = root;
  if (squared < 1.) { denominator = refinedRoot(root); }
  let magnitude = refinedDivide(roundedProduct(params.alpha, params.repulsion), denominator);
  let direction = vec2(refinedDivide(d.x, root), refinedDivide(d.y, root));
  return nearProduct(vec2(magnitude), direction);
}
fn nearProduct(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2(roundedProduct(a.x, b.x), roundedProduct(a.y, b.y));
}
`
}

// Match the scalar oracle's explicit direction/root divisions; normalize may
// use an approximate reciprocal square root on native GPU implementations.
export function refinedNearShader (source: string): string {
  source = replaceOnce(source, 'sum += pairVelocity(point.xy - positions[source].xy, randomDir, 1.);',
    'sum += nearPairVelocity(point.xy - positions[source].xy, randomDir);')
  source = replaceOnce(source, 'near += (mass / sampled) * sum;',
    'near += nearProduct(vec2(refinedDivide(mass, sampled)), sum);')
  source = replaceOnce(source, 'near += near * randomDir;', 'near += nearProduct(near, randomDir);')
  source = replaceOnce(source, 'let speed = length(near); if (speed > params.nearLimit) { near *= params.nearLimit / speed; }',
    `let squaredSpeed = roundedSquare(near.x) + roundedSquare(near.y);
  var speed = 0.; if (squaredSpeed > 0.) { speed = refinedRoot(squaredSpeed); }
  if (speed > params.nearLimit) { near = nearProduct(near, vec2(refinedDivide(params.nearLimit, speed))); }`)
  return refinedPairShader(source)
}
