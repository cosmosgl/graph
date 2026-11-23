type Guidance = Record<string, string>
const shared: Guidance = {
  count: 'Total simulated points. Larger inputs increase GPU work.',
  fixture: 'Deterministic input; use the same fixture when comparing backends.',
  checkpoint: 'Only selected ticks are validated; intervening ticks remain unchecked.',
  decay: 'Ticks until the cooling schedule ends; a cooled layout can still have residual forces.',
  pinned: 'Pinned points retain their positions while other points evolve.',
  repeats: 'Independent repetitions; compare their range as well as the median.',
  history: 'Retain the prior capacity growth before measuring the selected input.',
}
/* eslint-disable @typescript-eslint/naming-convention -- Keys match authored routes and control attributes. */
const guidance: Record<string, Guidance> = {
  'center-mass': {},
  'point-styling': {
    fixture: 'Shapes, overlaps and edge cases have different acceptance scope.',
    zoom: 'Camera scale shared by rendering and picking.',
    ratio: 'Framebuffer pixels per CSS pixel.',
    opacity: 'Global opacity. Zero opacity remains an explicit rejected picking control.',
    scale: 'Choose whether point size grows with camera zoom.',
    order: 'Reverse which overlapping shape is drawn last, keeping IDs stable.',
  },
  'scalable-reduction': {
    'point-count': 'All points participate in reduction; only a capped preview is drawn.',
    readback: 'Download the center for comparison. Without readback, per-tick accuracy is unchecked.',
  },
  'spatial-grid': {
    'point-count': 'Every point participates in the grid build and exhaustive validation.',
    'grid-size': 'Cells along each axis. More cells need larger count and offset buffers.',
    distribution: 'Changes cell occupancy and contention without changing point count.',
  },
  'neighborhood-forces': {
    radius: 'Interaction distance in simulation coordinates.',
    density: 'Compress the same input area to increase local neighbor density.',
    grid: 'Cells per axis. The force still checks the exact interaction radius.',
    accumulation: 'Choose the baseline or chunked traversal; both use the existing tolerance.',
    distribution: 'Changes the spatial arrangement and local neighbor density.',
  },
  'many-body': {
    mode: 'Shared-input checks isolate one tick; independent evolution also accumulates trajectory drift.',
    variant: 'Ordered direct reads or shared-memory tiles; both use the unchanged CPU gate.',
    'timing-fixture': 'A separate frozen input for the timing sweep, independent of the live layout.',
  },
  'many-body-grid': {
    quality: 'Controls the hierarchical approximation; compatibility and approximation error are separate.',
    slots: 'Sampling budget within each cell; more samples add work.',
  },
  'workgroup-repulsion': {
    quality: 'Controls the hierarchical approximation; compatibility and approximation error are separate.',
    slots: 'Sampling budget within each cell; more samples add work.',
    'far-mode': 'Workgroup memory is the candidate; the other modes are comparison controls.',
  },
  'repulsion-trajectories': {
    quality: 'Hierarchical approximation used by independently evolving layouts.',
    slots: 'Sample budget per cell; keep it fixed when comparing trajectories.',
  },
  'weighted-links': {
    'spring-loop': 'Traversal kernel. Neighbor accumulation order remains part of the comparison.',
    collision: 'Keep spring rest length above the endpoints’ collision radius; this does not run a separate collision force.',
    'sweep-count': 'Separate graph size for the diagnostic sweep.',
    'sweep-shape': 'Separate topology for the diagnostic sweep.',
    'sweep-backend': 'Backend to instrument; these checks can add readback overhead.',
  },
  'combined-layout': {
    center: 'Optional attraction toward the center of mass; off is the production default.',
    precision: 'Select the WebGPU arithmetic candidate. Changing it starts a new comparison.',
  },
  collision: {
    mode: 'Run collision alone or compose it with the other forces.',
    evolution: 'Shared input isolates one tick; independent input measures accumulated layout differences.',
    radius: 'Point radius in simulation coordinates.',
    padding: 'Extra separation added to the point radii.',
    iterations: 'Repeated collision passes within each tick.',
    arithmetic: 'Targeted correction fixes distance and contribution rounding. CPU tolerance stays unchanged.',
    centerReduction: 'Center-sum implementation used before collision in combined mode.',
    cooling: 'Scale collision strength by alpha raised to this exponent. Zero keeps collision strength fixed.',
    coolingTicks: 'Use fixed alpha or choose the number of ticks in the cooling schedule.',
    alpha: 'Initial force multiplier.',
    strength: 'Collision correction strength.',
  },
  'matched-layout': {
    center: 'Optional center attraction; center-off and center-on have separate evidence.',
    preset: 'Production-style force settings; quality budgets are separate from compatibility.',
    ticks: 'Independent evolution length; only checkpoint ticks are validated.',
    distribution: 'Initial positions shared by all three backends.',
  },
  'gpu-stage-profile': { history: 'Include a grow/shrink history before profiling; timing instrumentation is a separate control.' },
  'hub-springs': {
    degree: 'Neighbors attached to the hub; high degree concentrates serial spring work.',
    candidate: 'Order-preserving optimization compared with the plain kernel.',
    threshold: 'Minimum degree that activates cooperative prefetch.',
    capture: 'Measure cooled geometry or a restoring full-strength probe; their costs differ.',
  },
  'cell-aggregation': {
    candidate: 'Grid aggregation candidate; preserve the selected ordering contract.',
    preset: 'Production-style settings for the selected comparison.',
    distribution: 'Initial spatial density.',
    history: 'Evolve the input before measuring. Cooled controls also capture a full-strength probe.',
  },
  'layout-acceptance': {
    candidate: 'Candidate evaluated against the production preset gates.',
    preset: 'Production setting envelope; passing one preset does not validate the others.',
    history: 'Evolve the selected input before measuring; cooled controls also capture a full-strength probe.',
  },
  'performance-lab': {
    workload: 'An isolated render or reduction workload, not full Cosmos frame rate.',
    diameter: 'Circle diameter in drawing-buffer pixels. Larger circles increase fragment work.',
    preset: 'Warmups and measured samples. Setup is excluded from sampled iterations.',
  },
  'precision-diagnostics': {
    count: 'Vectors in the accuracy corpus.',
    seed: 'Deterministic seed for reproducible inputs.',
    fixture: 'Sum input with an independently known mathematical target.',
  },
}

/* eslint-enable @typescript-eslint/naming-convention */

export function addRunGuidance (host: HTMLElement, experiment: string): void {
  const local = guidance[experiment] ?? {}
  for (const control of host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
    const key = control.dataset.control ?? Object.keys({ ...shared, ...local }).find(name => control.hasAttribute(`data-${name}`))
    const text = key && (local[key] ?? shared[key]); const label = control.closest('label')
    if (!text || !label) continue
    const note = document.createElement('span'); note.className = 'control-guidance'; note.textContent = text
    // The label names the control; the linked description supplies its guidance.
    note.setAttribute('aria-hidden', 'true')
    note.id = `help-${experiment}-${key}`; label.append(note)
    control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), note.id].filter(Boolean).join(' '))
  }
}
