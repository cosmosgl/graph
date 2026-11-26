# Reproduce the mouse repulsion study

## Declared matrix

Compare unchanged production GLSL, the WebGPU pointer kernel and an independent
CPU reference. First run the 12-point analytic fixture with an origin pointer.
The points exercise all quadrants, both axes, distances below, at and above the
10-unit clamp, exact coincidence, a pin and two absent sentinels. Record the
coincident point's legacy force and displacement as an observation.

Next, use deterministic uniform inputs at 1,024 and 8,192 points with seed
29471. At 8,192, translate the origin to (2,048, −1,024), set zoom to 1.5 and
pan the canvas. Move the pointer through the declared screen offsets. For each
input check eight consecutive steps, with movement in the running state, a held
button in the paused state, release, right-click repulsion disabled, simulation
disabled, resume after viewport resize and a negative strength. Compare each
active step against its own frozen input and the independently evolved CPU
trajectory. Compare the two GPUs directly from the initial input. Check
unchanged positions after every inactive step.

Each timing batch repeats the same frozen force 16 times. Use two warmups and
seven measured batches per device and count, alternating device order. Validate
force and unchanged positions after timing. Keep unavailable timestamp data
as unavailable. GPU timing excludes position integration, setup, drawing,
uploads, CPU validation and readbacks.

## Run on the native machine

Retain an exact source snapshot including untracked sources and the lockfile
in a fresh ignored capture directory. Record the base revision, snapshot path
and unique capture name. Run the focused checks and the matrix in visible
Chrome with the native adapters. Use `LAB_NATIVE_VISIBLE=1`,
`LAB_MOUSE_REPULSION_STUDY=1`, `LAB_SOURCE_REVISION`,
`LAB_SOURCE_SNAPSHOT` and `LAB_ARTIFACT_RUN` with the lab's GPU runner.

```sh
pnpm --filter @cosmos.gl/gpu-lab test:gpu src/experiments/mouse-repulsion/mouse-repulsion.test.ts
```

Keep the page continuously visible and run without concurrent builds or tests.
The runner writes `mouse-repulsion-native.json` with adapter/browser identity,
all 34 backend rows, three direct pairs, 54 timing batches and six post-timing
checks. Report interrupted runs and numerical failures with their witnesses. A passing study
closes the declared isolated mouse-force comparison. Combined layout behavior,
interactive latency and broader devices require their own evidence.
