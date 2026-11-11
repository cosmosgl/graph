import source from '../many-body/force.wgsl?raw'
import { refinedPairShader } from '../many-body-grid/near-shader'
import { replaceOnce } from '../many-body-grid/trace'

export function strictExactShader (): string {
  let s = replaceOnce(source, 'let distance2 = dot(delta, delta);',
    'let distance2 = roundedSquare(delta.x) + roundedSquare(delta.y);')
  const start = s.indexOf('  var l = distance2;'); const end = s.indexOf('  if (distance2 <', start)
  if (start < 0 || end < 0) throw new Error('Exact repulsion shader anchors changed')
  s = `${s.slice(0, start)}  let velocity = nearPairVelocity(delta, randomDir);\n${s.slice(end)}`
  s = replaceOnce(s, 'params.nearLimit * params.nearLimit', 'roundedSquare(params.nearLimit)')
  s = replaceOnce(s, 'var near = sums.near + sums.near * randomDir;', 'var near = sums.near + nearProduct(sums.near, randomDir);')
  s = replaceOnce(s, 'let speed = length(near);', `let squaredSpeed = roundedSquare(near.x) + roundedSquare(near.y);
  var speed = 0.; if (squaredSpeed > 0.) { speed = refinedRoot(squaredSpeed); }`)
  s = replaceOnce(s, 'near *= params.nearLimit / speed;', 'near = nearProduct(near, vec2(refinedDivide(params.nearLimit, speed)));')
  return refinedPairShader(s)
}
