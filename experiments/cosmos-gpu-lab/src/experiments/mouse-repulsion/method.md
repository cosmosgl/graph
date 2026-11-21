# Mouse repulsion

When the right button is held and right-click repulsion is enabled, a point
five world units from the pointer gets the same force magnitude as a point
ten units away. Beyond ten units, doubling the distance quarters the force.
The force uses the direction from the pointer to the point. The default
strength is 2. Friction and the position-step bound apply during integration.

## From screen to world

Production reads a canvas-local pointer offset in CSS pixels. It subtracts
the pan translation, divides by zoom, adds the world offset and flips
vertical coordinates. The canvas client size in CSS pixels determines the
center at any framebuffer pixel ratio.

The preview sends that world position to both renderers. Move over either
canvas with the right button held, or use **Step and check** for a single
substep at the last pointer position. The preview keeps the ordinary forces
paused. In production, the right-button stage runs before the main force
sequence and has its own gate. Release, the right-click option and globally
disabling simulation stop the pointer stage. Pausing the main simulation
leaves the pointer stage available.

## Reference and guard

WebGL uses the production mouse-force and position shaders. The WebGPU
candidate keeps the same distance law and normalizes the separation vector
directly. The CPU reference computes the intended force in double precision
from float32 inputs and uses the lab's independent position integrator.

At exact coincidence, the direction is undefined in the production shader's
two-argument arctangent. WebGPU and the CPU reference choose zero force. The
experiment records the observed legacy result at that point. Use the
coincidence guard as a proposed behavior choice for integration. [GLSL ES
3.00 section 8.1](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf#page=93)

Compare finite ordinary forces and integrated coordinates at the existing
mixed float32 gate of `2e-5 + 3e-5 × abs(reference)`. Preserve pinned and
absent coordinates and all flags exactly. An absent point's force is unused.
An inactive stage must preserve every position exactly. Timings cover the
isolated force and are reported independently of numerical agreement.
