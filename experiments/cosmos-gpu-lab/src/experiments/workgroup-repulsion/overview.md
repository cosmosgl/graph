# Workgroup repulsion

The WebGPU panel runs hierarchical repulsion using a small amount of workgroup
memory for force contributions. It is the same force comparison as
[Hierarchical global repulsion](#/many-body-grid), with **Workgroup memory**
selected when this page opens. The WebGL and CPU panels use the same input.

Press **Step + validate** to calculate one step and see the checks. You can
change the fixture, point count and WebGPU method in Configuration; changing a
setting resets the view. Each step starts from the CPU model's positions, so
this view compares the same input rather than independent graph trajectories.

This comparison runs up to **16,384 points** and shows repulsion alone. A
separate [million-point moving graph](#/million-graph) now builds the hierarchy
on the GPU and draws a synthetic chain; it remains a lab-only prototype.
