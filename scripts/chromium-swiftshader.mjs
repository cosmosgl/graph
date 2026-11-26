// Linux Chromium needs a Vulkan compositor to present a WebGPU canvas on SwiftShader.
export const swiftShaderArgs = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  ...(process.platform === 'linux' ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader'] : []),
]
