import { createProduction } from './production'
import { loadProductionBundle } from './production-bundle'
Object.assign(window, { cosmosProduction: loadProductionBundle().then(() => createProduction(document.querySelector<HTMLDivElement>('#graph')!)) })
