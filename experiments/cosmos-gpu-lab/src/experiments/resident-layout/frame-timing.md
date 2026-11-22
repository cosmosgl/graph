The timing run uses a fresh graph. In each frame, one compute pass updates the layout. When drawing
is enabled, a render pass reads the resulting positions and draws circles and straight links.
Both passes are submitted together.

## Reading the timings

- **GPU work** adds the compute and render pass durations. The optional WebGPU timestamp feature
  supplies these numbers. When a complete set of valid timestamps is unavailable, the GPU cell
  says so and the CPU timings can still be read.
- **CPU submit** measures the time JavaScript spends preparing and submitting the work.
- **Through GPU completion** includes submission and the wait for the GPU to finish. It ends
  before fetching the timing and replay results.

These are milliseconds per frame. CPU and GPU work can overlap, and this run draws to an offscreen
target. The timings describe the layout and drawing workload before display presentation.
[WebGPU timestamp queries](https://gpuweb.github.io/gpuweb/#timestamp)

## Keeping the workloads comparable

Both arithmetic modes start with the same positions. Each workload gets the same batch length
of 4–16 frames, two warmups, and seven measured batches. The cooling setting controls how quickly
the forces weaken. The timed frames always come from the start of that schedule.

After each batch the experiment checks positions and forces against an untimed replay of the same
arithmetic mode. The native f32 mode is a timing reference with known mismatches in the
independent CPU force checks. The refined mode applies the corrections from those checks.
