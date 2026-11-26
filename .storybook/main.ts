import type { StorybookConfig } from "@storybook/html-vite";
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import remarkGfm from 'remark-gfm';
import { mergeConfig } from 'vite';

const webgpu = process.env['COSMOS_STORYBOOK_ENGINE'] === 'webgpu';
const engine = webgpu ? 'WebGPU' : 'WebGL';
const revision = process.env['GITHUB_SHA']?.slice(0, 10) || (() => {
  try { return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'local build'; }
})();

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../integrations/*/src/**/*.mdx",
    "../integrations/*/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@jls-digital/storybook-addon-code",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
    {
      name: '@storybook/addon-docs',
      options: {
        mdxPluginOptions: {
          mdxCompileOptions: {
            remarkPlugins: [remarkGfm],
          },
        },
      },
    },
  ],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  previewBody: (body) => `${body}<small id="cosmos-preview-build" data-engine="${engine}"
    style="position:fixed;bottom:4px;left:6px;z-index:10000;pointer-events:none;color:#f5f5f5;background:#242424;padding:2px 5px;font:11px/1.35 monospace"
    >${engine} · ${revision}</small>`,
  viteFinal: (base, { configDir }) => mergeConfig(base, {
    cacheDir: resolve(configDir, '../node_modules/.cache', `storybook-vite-${engine.toLowerCase()}`),
    server: { watch: { ignored: ['**/storybook-static*/**'] } },
    resolve: {
      // Use the same device family and the same host contract as the packed
      // integration. Both previews still import the original stories and data.
      alias: webgpu ? [
        { find: /^@cosmos\.gl\/graph$/, replacement: resolve(configDir, '../experiments/graph-webgpu/src/index.ts') },
        ...['core', 'layers'].map(name => ({
          find: new RegExp(`^@deck\\.gl/${name}$`),
          replacement: resolve(configDir, `../experiments/graph-webgpu/node_modules/@deck.gl/${name}/dist/index.js`),
        })),
        { find: /^@luma\.gl\/engine$/, replacement: resolve(configDir, '../experiments/graph-webgpu/node_modules/@luma.gl/engine/dist/index.js') },
        { find: './graph-host.js', replacement: resolve(configDir, '../experiments/graph-webgpu/deck-layers/graph-host.ts') },
        { find: /^\.\/story-device(\?raw)?$/, replacement: resolve(configDir, '../experiments/graph-webgpu/deck-layers/story-device.ts$1') },
        { find: /^\.\/thumbnail-background(\?raw)?$/, replacement: resolve(configDir, '../experiments/graph-webgpu/deck-layers/thumbnail-background.ts$1') },
        {
          find: /^\.\/(?:custom-deck-layers\/)?(points|links)-layer-uniforms(\?raw)?$/,
          replacement: resolve(configDir, '../experiments/graph-webgpu/deck-layers/custom-story/$1-layer-uniforms.ts$2'),
        },
      ] : [],
    },
  }),
};
export default config;
