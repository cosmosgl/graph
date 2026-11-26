// Enforce the lab's resource boundary, including diagnostic and test implementations.
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const forbidden = [
  /\.\s*handle\b/,
  /\.\s*queue\b/,
  /\bGPU(?:Device|Buffer|Texture|CommandEncoder|ComputePassEncoder|RenderPassEncoder|BindGroup|ComputePipeline|RenderPipeline|CanvasContext)\b/,
  /\bWebGL(?:2RenderingContext|RenderingContext|Buffer|Texture|Framebuffer|Program|Shader)\b/,
  /\bnavigator\s*\.\s*gpu\s*\??\./,
  /\.\s*getContext\s*\(\s*['"](?:webgl2?|experimental-webgl|webgpu)['"]/,
  /\.\s*(?:createShaderModule|createBindGroup|setBindGroup|mapAsync|getMappedRange|unmap|getExtension|drawArrays|fenceSync|clientWaitSync)\s*\(/,
]
const failures = []
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await inspect(path)
    else if (/\.tsx?$/.test(entry.name)) {
      const lines = (await readFile(path, 'utf8')).split('\n')
      lines.forEach((line, index) => {
        if (forbidden.some(pattern => pattern.test(line))) failures.push(`${relative(root, path)}:${index + 1}: ${line.trim()}`)
      })
    }
  }
}
await inspect(join(root, 'experiments'))
await inspect(join(root, 'gpu'))
if (failures.length) throw new Error(`Use luma APIs instead of native GPU handles or commands:\n${failures.join('\n')}`)
console.log('Luma API boundary check passed')
