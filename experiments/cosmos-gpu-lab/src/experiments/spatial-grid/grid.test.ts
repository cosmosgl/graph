import { it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { gridTrials, runGridTrial } from './grid-suite'

it.each(gridTrials)('indexes every $distribution point exactly once in a $gridSize × $gridSize grid', async trial => {
  await runGridTrial(trial, data => writeArtifact(`spatial-grid-${trial.distribution}`, data))
})
