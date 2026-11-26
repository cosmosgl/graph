# cosmos.gl website

## Local development

From the repository root, use Node.js 22 or later and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm website
```

Open [the local website](http://127.0.0.1:5173/).

## Build and deploy

- `pnpm build:website` builds the website into `website/dist/`.
- `pnpm build:pages` also builds Storybook at `/storybook/`. The GitHub Pages workflow runs from the `github_pages` release branch.

## Update the showcase

- Gallery entries are in [`src/examples.ts`](src/examples.ts) and preview images are in `public/examples/`.
- Live scenes are in `src/scenes/`. Each example has an HTML entry in `examples/`.
- See the [dataset documentation](datasets.md) for sources and hosting.

## Packed Graph qualification

In the 10 Million Points example, select **1 million** and run it. With each
installed Graph package on the Apple M3, the example rendered all 1,000,000
points in one draw. WebGL submitted one vertex per point and WebGPU submitted
four. The FPS counter waits for the drawing device to finish each frame. The
WebGPU page displays **Unavailable** for GPU draw time. A separate seven-point,
four-link dataset check verified the initial draw and canvas cleanup.

The full WebGL benchmark also rendered 10,000,000 points. On the tested WebGPU
device that selection needed 160,000,000 bytes for positions, exceeding the
134,217,728-byte limit granted to this device for a single storage binding.
The page reported the limit before generating the points. The full Roads
dataset has 1,890,815 points and 2,315,222 links. Its WebGPU point styles alone
would require 181,518,240 bytes at 96 bytes per point. Both full-size examples
remain outside the WebGPU candidate’s verified million-point range.
