import assert from 'node:assert/strict'

export const lassoMeshSeed = 2453
export const lassoForceSeed = 'lasso-replay'
export const expectedLassoMeshHash = 'cb810bbf41e9b84a70d2f398251251faa16748c9b4b1ad5e92f6c216b0f8480a'

// Each Lab run opens a fresh preview page. Seed only the random calls in that
// page's mesh generator; the browser and ordinary Storybook keep their own RNG.
export async function installLassoFixture(page) {
  await page.route(/\/src\/stories\/generate-mesh-data\.ts(?:\?|$)/, async route => {
    if (new URL(route.request().url()).searchParams.has('raw')) return route.fallback()
    const response = await route.fetch()
    const body = await response.text()
    assert.ok(body.includes('Math.random()'), 'Expected random calls in the Vite mesh generator')
    const generator = `let lassoState = ${lassoMeshSeed};
      function lassoRandom() {
        lassoState = (Math.imul(1664525, lassoState) + 1013904223) >>> 0;
        return lassoState / 4294967296;
      }`
    await route.fulfill({ response, body: generator + '\n' + body.replaceAll('Math.random()', 'lassoRandom()') })
  })

  await page.route(/\/src\/stories\/create-cosmos\.ts(?:\?|$)/, async route => {
    const original = new URL(route.request().url())
    if (original.searchParams.has('raw') || original.searchParams.has('original')) return route.fallback()
    original.searchParams.set('original', '1')
    await route.fulfill({
      contentType: 'text/javascript',
      body: `import { createCosmos as create } from ${JSON.stringify(original.href)};
        export function createCosmos(props) {
          const seeded = { ...props, randomSeed: ${JSON.stringify(lassoForceSeed)} };
          const result = create(window.prepareLassoProps?.(seeded) ?? seeded);
          window.lassoFixture = { graph: result.graph, initial: props.pointPositions, clusters: props.pointClusters };
          return result;
        }`,
    })
  })
}

// Serve the frozen package as a classic script. All Graph imports in the story,
// including helpers that only use enums, must share its luma instance.
export async function installLassoPackage(page, bundle) {
  const scriptUrl = '/__lab_lasso_' + bundle.sha256 + '.js'
  await page.route('**' + scriptUrl, route => route.fulfill({ path: bundle.file, contentType: 'text/javascript' }))
  await page.route(/^https?:\/\/[^/]+\/(?:experiments\/graph-webgpu\/)?src\/index\.ts(?:\?|$)/, async route => {
    if (new URL(route.request().url()).searchParams.has('raw')) return route.fallback()
    await route.fulfill({ contentType: 'text/javascript', body: `
      await (window.lassoPackageReady ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.onload = resolve; script.onerror = () => reject(new Error('Standalone package failed to load'));
        script.src = ${JSON.stringify(scriptUrl)}; document.head.append(script);
      }));
      export const { Graph, GraphSimulation, PointShape, LinkStyle, getRgbaColor, defaultConfigValues } = window.Cosmos;` })
  })
}
