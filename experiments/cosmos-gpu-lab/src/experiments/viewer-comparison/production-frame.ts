import controlUrl from '../../../../../dist/index.min.js?url'
import { createProduction } from './production'
// The published standalone bundle keeps production luma v9 separate from the lab's v10 optimizer.
const ready = new Promise<void>((resolve, reject) => {
  const script = document.createElement('script')
  script.src = controlUrl
  script.onload = (): void => resolve()
  script.onerror = (): void => reject(new Error('Build the workspace production UMD control before running this comparison'))
  document.head.append(script)
})
Object.assign(window, { cosmosProduction: ready.then(() => createProduction(document.querySelector<HTMLDivElement>('#graph')!)) })
