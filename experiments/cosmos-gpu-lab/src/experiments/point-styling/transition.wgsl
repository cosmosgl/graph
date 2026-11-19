struct Params { frame: vec4f, defaultColor: vec4f, defaultSize: f32, count: f32 }
struct Style { state: vec4f, color: vec4f }
@group(0) @binding(0) var<storage, read> sourcePosition: array<vec4f>;
@group(0) @binding(1) var<storage, read> targetPosition: array<vec4f>;
@group(0) @binding(2) var<storage, read> sourceColor: array<vec4f>;
@group(0) @binding(3) var<storage, read> targetColor: array<vec4f>;
@group(0) @binding(4) var<storage, read> attributes: array<vec4f>;
@group(0) @binding(5) var<uniform> params: Params;
@group(0) @binding(6) var<storage, read_write> current: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> styles: array<Style>;

fn isNan(value: f32) -> bool { return (bitcast<u32>(value) & 0x7fffffffu) > 0x7f800000u; }
fn resolveSize(value: f32, exit: f32) -> f32 {
  return select(value, mix(params.defaultSize, 0., exit), isNan(value));
}
fn resolveColor(value: vec4f, exit: f32) -> vec4f {
  let fallback = mix(params.defaultColor, vec4f(0.), exit);
  return select(value, fallback, vec4<bool>(isNan(value.x), isNan(value.y), isNan(value.z), isNan(value.w)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= u32(params.count)) { return; }
  let progress = params.frame.x;
  let attributesAtPoint = attributes[index];
  let animatePositions = params.frame.y > 0.;
  if (animatePositions) {
    let source = sourcePosition[index];
    let destination = targetPosition[index];
    let start = select(source.xy, destination.xy, isNan(source.x));
    let end = select(destination.xy, start, isNan(destination.x));
    current[index] = vec4f(mix(start, end, vec2f(progress)), source.z, 1.);
  }
  let absent = attributesAtPoint.w;
  let exit = select(absent, mix(attributesAtPoint.z, absent, progress), animatePositions);
  if (exit >= 1.) { styles[index] = Style(vec4f(0., exit, absent, 0.), vec4f(0.)); return; }

  let finalSize = resolveSize(attributesAtPoint.y, exit);
  let finalColor = resolveColor(targetColor[index], exit);
  let size = select(finalSize, mix(resolveSize(attributesAtPoint.x, exit), finalSize, progress), params.frame.w > 0.);
  let rgba = select(finalColor, mix(resolveColor(sourceColor[index], exit), finalColor, vec4f(progress)), params.frame.z > 0.);
  styles[index] = Style(vec4f(size, exit, absent, select(0., 1., size > 0.)), rgba);
}
