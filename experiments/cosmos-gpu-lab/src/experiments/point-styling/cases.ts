import type { ExperimentCase } from '../../runtime/experiment'
import type { StylingCaseId } from './case-view'

export const pointStylingExperimentIds: Record<StylingCaseId, string> = {
  shapes: 'point-shapes',
  picking: 'point-picking',
  images: 'point-images',
  effects: 'point-rings-greyout',
}

// The experiments share renderers. Each records its own inputs and findings.
export const cases = [
  {
    id: 'shapes',
    title: 'Point shapes',
    kind: 'compare',
    question: 'Do WebGL and WebGPU draw the same point shapes?',
    description: 'Both panels draw the same eight shapes. The top row is filled; the bottom row has an inset stroke.',
    tryIt: 'Choose Fractional sizes and compare the two WebGPU bounds at each pixel ratio.',
    reference: 'Production WebGL point sprites and an independent CPU shape mask.',
    acceptance: 'Strict compatibility checks every pixel. The practical check allows edge differences within one device pixel of the CPU contour. ' +
      'Elsewhere IDs and masks must match exactly and colors must stay within 2/255. Thin points must paint and invisible picks always fail.',
    recorded: {
      conclusion: 'Nine shape checks passed on M3, including zoom scaling, constant-size points and the one-pixel boundary rule for fractional circles.',
      date: '2026-11-23',
      environment: 'Apple M3 · Chrome 157 · luma 10.0.0-alpha.15',
      scope: 'Stationary shapes and strokes, both sizing rules at half zoom, defaults and fractional circles at pixel ratios 1 and 2.',
      limits: 'Strict edge differences remain. Moving subpixel points, other GPUs and exact polygon-edge ties still need validation.',
      evidence: [
        { label: 'How point shapes work', page: 'shapes-evidence' },
        { label: 'Automated test results', page: 'automated-cases' },
      ],
    },
  },
  {
    id: 'picking',
    title: 'Point picking',
    kind: 'compare',
    question: 'Which point is selected where shapes overlap?',
    description: 'Both panels show the same overlapping points. Their readouts identify the point at the inspected pixel.',
    tryIt: 'Press Inspect center pixel to compare the two point IDs. Change Draw order to Reversed and check again.',
    reference: 'Production host-picking IDs, the WebGPU ID image and an independent CPU shape mask.',
    acceptance: 'IDs and masks must match the selected picking rule; an invisible point must not claim a pixel.',
    recorded: {
      conclusion: 'A stored-alpha prototype avoided invisible picks without changing color bytes in bounded checks on one GPU and a software renderer.',
      date: '2026-11-16',
      environment: 'Apple M3 · inline Chromium 157; Linux SwiftShader · Chromium 151',
      scope: 'Selected alpha boundaries and overlapping points, including retained source-byte controls.',
      limits: 'This is a bounded prototype, not production hover latency or all-device picking acceptance; earlier source-byte failures remain.',
      evidence: [{ label: 'Point-picking evidence', page: 'picking-evidence' }],
    },
  },
  {
    id: 'images',
    title: 'Point images',
    kind: 'compare',
    question: 'Do point images render and pick correctly, including transparent areas?',
    description: 'Both panels draw the same images from an atlas. Transparent areas and faint pixels exercise image sampling and picking.',
    tryIt: 'Compare the image-only scene, then choose an overlapping or updating image scene.',
    reference: 'Production WebGL, the WebGPU port and independently sampled CPU image colors and picking masks.',
    acceptance: 'The selected rule requires exact IDs and masks, no invisible picks, and colors within 2/255.',
    recorded: {
      conclusion: 'The source-byte candidate passed the 40-row image-atlas matrix on one GPU; production compatibility did not pass that matrix.',
      date: '2026-11-13',
      environment: 'Apple M3 · inline Chromium 157 · luma 10.0.0-alpha.4',
      scope: 'Four image fixtures, nearest and linear filtering, and five frozen display profiles.',
      limits: 'The candidate and production controls answer different questions. Other atlas layouts, image decoding and devices require their own evidence.',
      evidence: [{ label: 'Point-image evidence', page: 'images-evidence' }],
      charts: [{
        title: 'The picking rule removed invisible picks in the overlap',
        context: 'Pixels where picking returned an invisible foreground · Per backend · Nearest-filter fixture',
        unit: 'pixels',
        bars: [['Original rule', 4752], ['Source-byte rule', 0]],
      }],
    },
  },
  {
    id: 'effects',
    title: 'Point rings and greyout',
    kind: 'compare',
    question: 'Do rings and greyout preserve point colors and picking?',
    description: 'Both panels draw the same highlighted and greyed points. Rings are decorative and should not change the picked ID.',
    tryIt: 'Compare the overlapping points, then change the scene or the greyout profile.',
    reference: 'Production and candidate GPU images, independent CPU colors and the unchanged scalar picking mask.',
    acceptance: 'Colors must stay within 2/255, IDs and masks must match exactly, and decorative rings must not change IDs.',
    recorded: {
      conclusion: 'The pixel-distance overlay passed CPU color checks in 96 cases on one GPU and a software renderer; ' +
        'eight polygon-mask rows remained rejected.',
      date: '2026-11-16',
      environment: 'Apple M3 · inline Chromium 157; Linux SwiftShader · Chromium 151',
      scope: 'Four scenes, eight effect profiles and three views, including overlays and greyout.',
      limits: 'The rejected polygon boundaries and separate production-compatibility results remain open; transitions are not checked.',
      evidence: [{ label: 'Ring and greyout evidence', page: 'effects-evidence' }],
    },
  },
] satisfies Array<ExperimentCase & { id: StylingCaseId }>
