Start with one Cosmos tick: **read positions, calculate new positions, draw them**.
Three kinds of things work together:

- **Resources hold data:** positions, velocities, colors.
- **Shaders describe calculations:** move a point, add values, color a fragment.
- **Commands schedule work:** run this shader using these resources.

The examples below are **interactive teaching models**, calculated in JavaScript. They work without GPU access
and demonstrate relationships, not hardware scheduling or performance. Hover, focus or tap an underlined term
for its quick definition without leaving the page.

## 1. Connect to the GPU

An **adapter** describes a GPU implementation the browser can expose. It reports supported features and limits.
A **device** is the logical connection you request through that adapter. You use it to create resources and submit work.
Think of the adapter as “which workshop is available?” and the device as “my connection to that workshop.”

```flow row
Adapter · What is available?
Device · Create resources and commands
Queue · Submit work
```

The device does not give a tab exclusive ownership of the physical GPU. Other applications can use the same hardware.
Limits constrain buffer sizes, workgroup sizes and more. Device loss can invalidate that connection; a real application
must handle it. Cosmos should normally share the host application's device, rather than create one per force.

## 2. Put the numbers somewhere

A **buffer** is a block of bytes. A shader interprets those bytes according to a declared layout.
For point positions, we might interpret them as pairs of 32-bit floats:

```text
Point index       0          1          2
Positions       [x0, y0]   [x1, y1]   [x2, y2]
```

A million positions need 8 MB for these two coordinates alone. Velocities, colors and temporary results add more.

A **storage buffer** holds arrays or structures that shaders can read and, when allowed, write. Positions belong here.
A **uniform buffer** supplies shared read-only parameters, such as the time step, force strength or camera transform.
Every invocation can read the same time step while reading a different point.

JavaScript and WGSL must agree on the byte layout, including alignment and padding. Buffers declare usage flags at creation:
storage, uniform, copying, mapping and so on. Those flags are permissions for future uses, not commands to perform them.

A **texture** stores formatted texels: images, render targets, or numerical data. A **texture view** selects the part
of a texture a command accesses, such as one mip level or array layer. It does not copy the texture.
A **sampler** defines filtering and addressing behavior for sampled texture reads. A buffer binding can similarly expose
a range of existing buffer storage without copying it.

**Cosmos connection:** WebGL uses data textures for much of the simulation. WebGPU storage buffers let us express those
numbers directly as arrays. Textures remain useful for rendering and image data.

## 3. Run one shader many times

A **compute shader** is a GPU program for general calculations. **WGSL** means WebGPU Shading Language.
An **invocation** is one execution of a shader. A typical point calculation gives each invocation a different point index.

```text
Invocation 0 → calculate point 0
Invocation 1 → calculate point 1
Invocation 2 → calculate point 2
```

One invocation per point is an algorithm choice. An invocation could instead process several points or one grid cell.
An invocation is a logical execution, not a physical GPU core; the GPU schedules it onto hardware.

A **workgroup** contains invocations that can cooperate through workgroup memory and barriers.
A **dispatch** launches a grid of workgroups. The shader declares invocations per workgroup; the command specifies
how many workgroups to launch. There is no guarantee that groups execute in numerical order.

```example
invocations
```

Try **10 points and workgroup size 4**, then select invocation **10**. Three complete groups launch 12 invocations,
so two must skip the calculation. For a one-dimensional dispatch:

```text
global ID = workgroup ID × workgroup size + local ID
        5 =            1 ×              4 +        1
```

For a million points at 256 invocations per group, we need `ceil(1,000,000 / 256) = 3,907` groups.
That launches 1,000,192 invocations; 192 skip. The small sizes in the illustration make the mapping visible,
not a recommendation for the fastest configuration.

## 4. Read a small shader

This moves every point slightly right. It illustrates the execution model, rather than a Cosmos force.
The output buffer must have room for all the input positions.

```wgsl
@group(0) @binding(0)
var<storage, read> before: array<vec2f>;

@group(0) @binding(1)
var<storage, read_write> after: array<vec2f>;

@compute @workgroup_size(4)
fn movePoint(
  @builtin(global_invocation_id) id: vec3u
) {
  let i = id.x;
  if (i >= arrayLength(&before)) {
    return;
  }
  after[i] = before[i] + vec2f(0.01, 0.0);
}
```

- `before` is the input position array; `after` is the output array.
- `vec2f` holds two 32-bit floats. `vec3u` holds three unsigned 32-bit integers.
- Dispatches can have X, Y and Z dimensions. Here we only use `id.x`.
- The bounds check handles the extra invocations in the last group.
- Each valid invocation reads one input and writes one output.

This early return is safe here because the shader has no workgroup barrier. A shader with a barrier needs a different
tail strategy: all participating invocations must reach that barrier in uniform control flow.

## 5. Connect the shader to actual resources

A **binding** is a numbered resource slot. A **bind group** fills those slots with actual buffers, texture views or samplers.
A **bind group layout** describes the contract: which slots exist and what resource types they accept.

```text
Bind group 0
  binding 0 → position buffer A → shader's “before”
  binding 1 → position buffer B → shader's “after”
```

**The shader's `@group(0)` means bind group 0. It has no relationship to workgroup 0.**
A bind group's assignments are fixed after creation, but the data inside its buffers can change.

A **compute pipeline** packages a compiled compute entry point and its resource interface. A **render pipeline**
adds drawing configuration, such as vertex inputs, primitive topology, blending and depth state.
Create pipelines during setup and reuse them across ticks. Updating a time step does not require recompiling the shader.

## 6. Record, submit, then execute

A **command encoder** records work. A **compute pass** contains dispatches; a **render pass** draws into attachments,
such as the canvas's presentation texture. Finishing the encoder produces a **command buffer**, which is submitted to the queue.

```flow
Record · Begin a command encoder
Compute pass · Calculate forces, then update positions
Render pass · Draw the updated positions
Finish · Produce a command buffer
Submit · Put it on the device queue
Execute · The GPU performs the work
```

**Submitted does not mean finished.** JavaScript can continue while the GPU executes.
Correctly ordered GPU work can consume earlier GPU results without a CPU readback between steps.
A subsequent dispatch can use completed results from a previous dispatch; the browser manages the required GPU dependencies.

Luma provides APIs for creating resources and recording this work. The concepts still apply through those APIs.
`GPUCommandGraph` is a higher-level luma scheduling abstraction, not a standard WebGPU object.

## 7. Coordinate parallel work

A **race condition** occurs when conflicting accesses make the result depend on execution timing.
Two invocations doing an ordinary increment on the same counter can lose an update:

```text
Counter starts at 7
A reads 7     B reads 7
A writes 8    B writes 8
Result: 8     Expected: 9
```

An **atomic operation** performs an operation indivisibly on one memory location. An atomic increment solves this counter
problem. It is useful when many points count themselves into the same grid cell. It does not synchronize an entire algorithm.
Portable core WGSL atomics operate on integer types; do not assume floating-point atomic addition is available.

**Workgroup memory** is scratch storage shared within one workgroup. A **barrier** coordinates accesses between phases:

```flow
Each invocation · Write its partial value into workgroup memory
workgroupBarrier() · All invocations in this group reach this point
Combine · Read the values written by teammates
```

A workgroup barrier cannot wait for every workgroup in the dispatch. For a global phase boundary, record another dispatch.
There is no CPU round trip required between those dispatches. Do not put a barrier behind a condition that only some
invocations take; out-of-range invocations can contribute a neutral value, such as zero for a sum, and still participate.

## 8. Keep a stable snapshot with ping-pong buffers

When a point reads neighbors while writing its new position, updating one shared array in place can mix old and new values.
**Ping-pong buffers** separate the input snapshot from the output. Swap their roles after each tick; no full-array copy is needed.

```example
pingPong
```

This toy movement is independent per point, so it could be done in place. The two-buffer arrangement becomes important
when points read one another. After tick 1, B holds the current positions. After tick 2, A does. The renderer follows the current buffer.

## 9. Combine many values with reduction

A **reduction** combines a collection into fewer values: a sum, maximum, bounding box or center of mass.
A tree makes independent additions possible at each level.

```example
reduction
```

This illustrates a tree inside one group, not one dispatch per row. Real group reductions use shared memory and barriers
between levels. Large inputs additionally need separate dispatches to combine results from different groups.

For equal-mass points, reduce each `(x, y, 1)` into `(sumX, sumY, count)`, then divide the sums by the count.
If each group reduces 256 records to one, the hierarchy is:

```flow row
1,000,000 inputs
3,907 partials
16 partials
1 result
```

Floating-point addition rounds, so changing the tree can slightly change the result. **ULP** is the spacing between
neighboring representable floating-point numbers at a given magnitude. Immediately above `1.0`, the next `f32` is
`1.0000001192092896`: a one-ULP step of `2⁻²³`. The spacing changes with magnitude. Correctness needs error checks as well as timing.

Continue with [Parallel reduction](#/concepts/reduction), [Global center of mass](#/center-mass), or [Scalable reduction](#/scalable-reduction).

## 10. Organize neighbors with scan, scatter and CSR

These are algorithms and data structures, not special WebGPU objects.
A **scan**, or prefix sum, computes cumulative totals. An exclusive scan excludes the current entry: counts `[3, 0, 2]`
produce starting offsets `[0, 3, 3]`. Append the total `5` to delimit the final range.

A **scatter** writes elements to calculated destinations. A **gather** reads from calculated source indices.
**CSR**, compressed sparse row, stores variable-length rows using offsets into one packed array.
Rows can represent graph neighbors; the same arrangement can store points grouped by spatial cell.

```example
grid
```

The range for cell `c` is `offsets[c]` up to, but excluding, `offsets[c + 1]`.
Equal offsets mean an empty cell. The illustration keeps point IDs in ascending order within each cell for readability.
A GPU scatter using atomic slot allocation may produce a different within-cell order; membership and ranges must still be correct.

A spatial grid lets local forces visit nearby cells instead of every point. It does not automatically replace global many-body repulsion.
Explore [Spatial grid builder](#/spatial-grid) and [Neighborhood forces](#/neighborhood-forces).

## 11. Turn positions into circles

A **vertex shader** computes vertex positions and associated values. **Rasterization** determines which samples triangles cover.
A **fragment shader** computes outputs such as color and circle-edge coverage for the generated fragments.
A fragment is not necessarily one final visible pixel: overlap, depth tests and multisampling affect the result.

```example
rendering
```

A circle can start as a square made from two triangles. The vertex shader places its corners around the point.
The fragment shader measures distance from the center and removes or fades coverage outside the radius.
The illustration uses ideal vector shapes, not a pixel-accurate rasterizer; a real shader can smooth the circle edge.

**Instancing** repeats the same base geometry for many points, each with its own position, radius and color.
Four corners can be drawn with six triangle indices, or as six non-indexed vertices, among other arrangements.

**Blending** combines fragment output with the existing render-target value. Our WebGL center-of-mass experiment uses additive
blending for accumulation. Compute shaders do not inherit this render-target operation: they use explicit storage writes,
reductions and appropriate synchronization. Try [Circle point rendering](#/point-rendering).

## 12. Keep the simulation on the GPU

**GPU-resident data** stays in resources that subsequent GPU work can directly consume.
Simulation writes positions; rendering reads those positions. JavaScript does not need to inspect every position every tick.

```flow
Upload once · Initial positions and graph data
Simulate · Update GPU buffers
Draw · Consume the current position buffer
Repeat · Continue with the next tick on the GPU
```

**Readback** makes GPU results available to the CPU, commonly by copying into a CPU-readable staging buffer and awaiting mapping.
A tiny center result transfers less data than a million positions, but even a small readback can require waiting.
Unified physical memory does not eliminate synchronization and access rules.

For performance comparisons, CPU submission time, GPU execution time and end-to-end frame time answer different questions.
Use [Performance lab](#/performance-lab) for measured experiments; none of the teaching models on this page measures GPU speed.

## Read next

Use the [vocabulary](#/vocabulary) for individual definitions and the [migration roadmap](#/roadmap) for what Cosmos still needs to prove.
The central chain to recognize in code is **buffer → binding → shader invocation → workgroup → dispatch → queue**.

Primary references for further study:

- [WebGPU specification](https://www.w3.org/TR/webgpu/): devices, resources, pipelines and command ordering.
- [WGSL specification](https://www.w3.org/TR/WGSL/): types, layouts, atomics and synchronization rules.
- [WebGPU Fundamentals: compute shaders](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html): invocation IDs and dispatch sizes.
- [WebGPU Fundamentals: storage buffers](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html): resource access examples.
- [WebGPU Fundamentals: inter-stage variables](https://webgpufundamentals.org/webgpu/lessons/webgpu-inter-stage-variables.html): vertex-to-fragment data flow.
