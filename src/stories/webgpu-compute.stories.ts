import type { Meta, StoryObj } from '@storybook/html'
import { helloLumagl } from './webgpu-compute/hello-lumagl'

import helloLumaglRaw from './webgpu-compute/hello-lumagl?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta = {
  title: 'Examples/WebGPU Compute',
}

export const HelloLumagl: StoryObj = {
  render: (): HTMLDivElement => {
    const result = helloLumagl()

    // For async story functions, create a simple div and update it when ready
    const div = document.createElement('div')
    div.style.height = '100vh'
    div.style.width = '100%'
    div.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">' +
      'Loading WebGPU compute story...</div>'

    result.then((story) => {
      // Replace the content with the actual story div
      div.innerHTML = ''
      div.appendChild(story.div)
    }).catch((error) => {
      console.error('Failed to load WebGPU compute story:', error)
      div.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; ' +
        'color: #ff0000;">Failed to load WebGPU compute story</div>'
    })

    return div
  },
  parameters: {
    sourceCode: [
      { name: 'Story', code: helloLumaglRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
