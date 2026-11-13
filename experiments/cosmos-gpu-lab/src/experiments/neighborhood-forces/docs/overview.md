# From a spatial grid to motion

This experiment compares **two WebGPU implementations of the same local repulsion rule**:
tiled all-pairs traversal and spatial-grid neighbor traversal. It connects the existing
[grid builder](#/spatial-grid) to force calculation, integration and
[circle rendering](#/point-rendering).

```flow
Positions at tick N
Spatial grid · Count → scan → scatter → grid neighbor forces | Tiled all-pairs · Reference neighbor forces
Integrate · Each method writes its own separate output buffers
Render circles · Read GPU positions directly
Swap buffers · Ready for tick N + 1
```

Both simulations start with identical deterministic positions, zero velocities, the same force
parameters and the same circle shader. They have independent position and velocity buffers
on one luma-created WebGPU device. All points are rendered; there is no display sampling.

## Try it

1. Start with **1,024 / Uniform**. Use **Step** or **Play** to watch both paths evolve.
2. Choose **Validate next step**. It computes a trial step without advancing the displayed tick,
   compares forces, neighbor counts, next velocities and positions with a CPU reference.
3. Choose **Eight clusters** or **Diagonal** to stress cell occupancy.
4. Increase the radius or choose a finer grid. The search expands beyond 3×3 cells when needed.
5. Choose **Boundary + coincidence** to include exact walls, cell boundaries and overlapping points.
6. Run **Benchmark**, then **Export JSON** to save raw samples and validation results.
7. Use the **Repeatable parameter sweep** section to vary count, density, radius and cell width,
   then export the entire run. The Sweep tab explains matrices, ordering and cancellation.

Changing a preset recreates the experiment at tick zero. Reset restores the current preset.
Playback advances fixed 1/60-second steps, one per animation callback after both methods complete;
it does not attempt real-time catch-up. Pause stops scheduling new steps; an in-flight step finishes.

## Scope

The all-pairs path is limited to 4,096 points because it examines N(N−1) candidates per tick.
The grid-only presets reach 65,536 points. Larger populations and dense distributions need
measurement before increasing that cap: a grid can still degrade toward quadratic work.

This is finite-radius local repulsion, **not a replacement for Cosmos's global many-body force**.
There are no graph links, attraction, picking, camera controls or WebGL force implementation here.
The point diameter is purely visual and independent of the interaction radius.
