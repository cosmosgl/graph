import type { Preview } from "@storybook/html";
import { themes } from '@storybook/theming';

import './style.css';

// Sidebar order. Sections are the one axis: each names a feature area, and a
// story belongs to exactly one. Audience ("beginner") and intent ("perf") are
// story `tags` instead, so a story never has to choose between being filed by
// what it teaches and who it is for. Storybook surfaces tags in the sidebar's
// "Tag filters" menu, so `beginner` collects the gentle stories from every
// section without any of them being duplicated there.
//
//   beginner     readable start to finish with no prior cosmos.gl knowledge
//   advanced     assumes the data model (index spaces, NaN absence) or GPU specifics
//   perf         exists to show a cost or a limit, not a feature; usually has an FPS monitor
//   interactive  has something to drive — buttons, panels, click/hover behaviour
//   large-data   tens of thousands of points or more; slow to start on weak hardware
//   labels       renders DOM overlays positioned from graph coordinates
//
// Write these as inline string literals in each story. Storybook indexes story
// files by static analysis and rejects anything else with "CSF: Expected tag to
// be string literal" — a shared TAGS constant fails the build's indexing step
// while still exiting 0, so the sidebar silently empties. The `order` below is
// read by the same parser and must stay inline for the same reason; 'Camera' is
// listed ahead of its stories so the section lands in place once it exists.
const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    options: {
      storySort: {
        order: [
          'Welcome to cosmos.gl',
          'Configuration',
          'API Reference',
          'Examples',
          [
            'Get Started',
            'Points',
            'Links',
            'Forces',
            'Interaction',
            'Camera',
            'Updating Data',
            'Showcase',
            'Performance',
          ],
        ],
      },
    },
    controls: {
      disable: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      theme: themes.dark,
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'light', value: '#fff' },
        { name: 'dark', value: '#192132' },
      ],
    },
  },
};

export default preview;
