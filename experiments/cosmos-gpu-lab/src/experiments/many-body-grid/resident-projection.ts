export const residentProjection = `
@group(0) @binding(1) var<storage, read> view: vec4f;
@group(0) @binding(2) var<uniform> display: vec4f;
fn project(point: vec2f) -> vec2f {
  let center = view.xy + vec2f(view.z * 0.5);
  return (point - center) * vec2f(2. / (view.z * 1.1 * (display.x / display.y)), 2. / (view.z * 1.1));
}
`
