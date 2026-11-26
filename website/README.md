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

Both packages also rendered the stock home galaxy (48,000 points), Worm
(10,000), Lorenz (38,000), Point Collisions (50,000) and Knowledge Network
(5,570 from the bundled arXiv dataset). All four example pages accepted
zoom and fit.

### Full-size Roads and 10 Million Points

The stock website built from `c418e90a` drew both full datasets on Apple M3 in Chrome 158. The clean app installed the public Graph archive `47f664b3` and Deck archive `d2d9b440`. The Graph standalone SHA-256 starts with `2bb22046`. The WebGL control used `74a216a7`.

| Stock example | WebGL | WebGPU, Graph-owned grant of 160,000,000 bytes | WebGPU, device granted 128 MiB |
| --- | --- | --- | --- |
| California–Nevada Roads | 1,890,815 points and 2,315,222 links | Both full draws | Both full draws |
| 10 Million Points | 10,000,000 points in one draw | 10,000,000 instances in one four-vertex draw | The page reports the 160,000,000-byte position requirement before generating the points |

The earlier WebGPU build (`754a02b6`) needed 181,518,240 bytes to repeat the same Roads point style. The new build stores the common style once. With the ordinary public constructor on M3, the initial Roads canvas reproduced every pixel from the earlier 256 MiB diagnostic. Against WebGL, 583,186 of 585,000 raw canvas pixels matched exactly. All 190 pixels differing by more than two channel levels fell in neighborhoods that varied by at least 13 levels in both engines. At a foreground threshold of more than two levels from the background, six pixels changed foreground membership. Each was within one device pixel of foreground in the other engine. At a threshold of 64, the maximum distance was two pixels.

Both Roads grants passed zoom, fit and trusted clicks. Clicking the midpoint of link 38,695 returned that link. Changing point 31,459 to an opaque red 48 px circle changed a nearby click from point 31,462 to 31,459. Clearing the override restored the original ID and every pixel of the unedited view.

In the ten-million-point scene, 989,575 of 990,000 raw canvas pixels matched WebGL exactly, with a maximum channel difference of four. Both packages zoomed, fit and released the data. Separate rectangle and lasso queries on the live graph returned the expected IDs on both sides of the first native compute row (3,333,376) and the 128 MiB record boundary (8,388,608). Five tracked IDs, including 9,999,999, returned the generated positions exactly.

The 128 MiB check uses the same M3. The harness makes an above-limit device request fail and verifies the successful fallback's actual `GPUDevice.limits`. The million-point and larger tests on a second physical GPU remain open.

The six reports, raw and composited images, image histograms, and edge coordinates are in `experiments/cosmos-gpu-lab/captures/full-site-capacity-20261126/signed-c418e90a/`. The parent capture's `README.md` contains the replay commands. Its `build-site.py` consumes two installed Graph packages and the unchanged website. The compressed Roads dataset SHA-256 is `c6039f43346347f44b50b18440372facec8a56603ddb403808ac9e07cecb585c`. The package hashes and clean consumer are in `captures/signed-graph-deck-c418e90a-7np86iv8/` under the GPU Lab. [Migration roadmap](../experiments/cosmos-gpu-lab/src/docs/roadmap.md#what-remains)
