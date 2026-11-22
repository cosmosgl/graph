import type { DatasetSceneDefinition } from './types'

export const westernRoads: DatasetSceneDefinition = {
  id: 'western-roads',
  title: 'California–Nevada Road Network',
  description: 'The original DIMACS road graph of California and Nevada. Its 4,657,742 directed arc records ' +
    'include opposite directions and repeated endpoint pairs, which are drawn once.',
  pointCount: 1890815,
  linkCount: 2315222,
  background: '#111318',
  source: { label: 'Data: DIMACS Shortest Paths Challenge ↗', url: 'https://web.archive.org/web/*/http://www.dis.uniroma1.it/challenge9/download.shtml' },
  dataset: {
    file: import.meta.env.VITE_ROADS_DATASET_URL?.trim() || 'https://d.cosmograph.app/cosmos.gl/dimacs-cal.cgd.gz',
    pointSize: 0.25,
    linkWidth: 0.6,
    pointColor: '#1982c435',
    linkColor: '#52a675a8',
    initialView: { center: [-0.4, 0.19], height: 1.65 },
  },
}
