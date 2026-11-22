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
