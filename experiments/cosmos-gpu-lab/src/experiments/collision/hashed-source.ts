import { COLLISION_ROTATIONS } from '../../../../../src/modules/ForceCollision/collision-grid'
import product from '../../gpu/rounded-product.wgsl?raw'
import { replaceOnce } from '../many-body-grid/trace'
import { collisionForceSource } from './force-source'
import gridSource from './hashed-grid.wgsl?raw'
import buildSource from './hashed-build.wgsl?raw'

const grid = replaceOnce(gridSource, '// @collision-rotations', COLLISION_ROTATIONS.map(([a, b], axis) =>
  `const rotation${axis === 0 ? 'X' : 'Y'} = vec2u(${a}u, ${b}u);`).join('\n'))

export const collisionSlotBuildSource = product + grid + buildSource
export const cachedCollisionSlotBuildSource = `${replaceOnce(collisionSlotBuildSource,
  'let bucket = collisionSlotBucket(collisionWorldCell(point.xy));', `
  let cell = collisionWorldCell(point.xy);
  pointCells[id.x] = cell;
  let bucket = collisionSlotBucket(cell);`)}
@group(0) @binding(5) var<storage, read_write> pointCells: array<vec2i>;`

export function collisionSlotForceSource (cacheCells = false): string {
  // Retain the small-graph candidate's correction math. Only change how
  // neighbors are found, in the production 3×3 cell and peeled-hash order.
  let force = collisionForceSource('targeted')
  force = replaceOnce(force, '  let reject = springAdd(ownRadius, params.maxRadius); let rejectSquare = springMul(reject, reject);\n', '')
  force = replaceOnce(force, 'let dist2 = square(delta); if (!(dist2 < rejectSquare)) { continue; }', 'let dist2 = square(delta);')
  const start = force.indexOf('  for (var other = 0u;')
  const pair = force.indexOf('    let delta = ', start)
  const end = force.indexOf('\n  }\n  var cooling', pair)
  if (start < 0 || pair < 0 || end < 0) throw new Error('Collision response shader layout changed')
  const correction = force.slice(pair, end).split('\n').map(line => `    ${line}`).join('\n')
  return `${force.slice(0, start)}  let ownCell = ${cacheCells ? 'pointCells[index]' : 'collisionWorldCell(point.xy)'};
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let cell = ownCell + vec2i(x, y);
      let base = collisionSlotBucket(cell) * grid.capacity;
      for (var slot = 0u; slot < grid.capacity; slot++) {
        let entry = slots[base + slot];
        if (entry == 0u) { break; }
        let other = entry - 1u;
        if (other == index) { continue; }
        let source = positions[other];
        if (any(${cacheCells ? 'pointCells[other]' : 'collisionWorldCell(source.xy)'} != cell)) { continue; }
${correction}
      }
    }${force.slice(end)}
${grid}
@group(0) @binding(4) var<uniform> grid: CollisionGrid;
@group(0) @binding(5) var<storage, read> slots: array<u32>;
${cacheCells ? '@group(0) @binding(6) var<storage, read> pointCells: array<vec2i>;' : ''}
`
}
