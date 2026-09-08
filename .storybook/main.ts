import type { StorybookConfig } from "@storybook/html-vite";
import remarkGfm from 'remark-gfm';

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
};
export default config;
