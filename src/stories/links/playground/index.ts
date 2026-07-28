import { Graph, LinkStyle, type GraphConfig } from '@cosmos.gl/graph'

import { generateHyperbolicGraph } from '../../utils'

interface ControlHandlers {
  onStyleChange: (style: LinkStyle) => void;
  onGradientChange: (on: boolean) => void;
  onCurvedChange: (on: boolean) => void;
  onArrowsChange: (on: boolean) => void;
  onScaleOnZoomChange: (on: boolean) => void;
}

/** Builds the floating control panel (stroke-pattern radios + option checkboxes). */
function buildControls (handlers: ControlHandlers): HTMLDivElement {
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute',
    'top: 16px',
    'right: 16px',
    'z-index: 1000',
    'display: flex',
    'flex-direction: column',
    'gap: 8px',
    'padding: 14px 16px',
    'background: rgba(22, 22, 28, 0.85)',
    'border: 1px solid rgba(255, 255, 255, 0.12)',
    'border-radius: 10px',
    'color: #e8e8ec',
    'font: 13px Helvetica, Arial, sans-serif',
    'user-select: none',
  ].join(';')

  const heading = (text: string): HTMLDivElement => {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = 'font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px;'
    return el
  }

  // Stroke pattern (mutually exclusive → radio group).
  panel.appendChild(heading('Stroke pattern'))
  const styleOptions: [string, LinkStyle][] = [['Solid', LinkStyle.Solid], ['Dashed', LinkStyle.Dashed], ['Dotted', LinkStyle.Dotted]]
  for (const [label, style] of styleOptions) {
    const row = document.createElement('label')
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'link-style-pattern'
    input.checked = style === LinkStyle.Solid
    input.addEventListener('change', () => { if (input.checked) handlers.onStyleChange(style) })
    row.append(input, document.createTextNode(label))
    panel.appendChild(row)
  }

  // Divider.
  const divider = document.createElement('div')
  divider.style.cssText = 'height: 1px; background: rgba(255, 255, 255, 0.12); margin: 4px 0;'
  panel.appendChild(divider)

  // Independent options (checkboxes).
  panel.appendChild(heading('Options'))
  const checkbox = (label: string, onChange: (on: boolean) => void): HTMLLabelElement => {
    const row = document.createElement('label')
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.addEventListener('change', () => onChange(input.checked))
    row.append(input, document.createTextNode(label))
    return row
  }

  panel.appendChild(checkbox('Gradient (endpoint colors)', handlers.onGradientChange))
  panel.appendChild(checkbox('Curved links', handlers.onCurvedChange))
  panel.appendChild(checkbox('Arrows', handlers.onArrowsChange))
  panel.appendChild(checkbox('Scale links on zoom', handlers.onScaleOnZoomChange))

  return panel
}

/**
 * A larger graph (~5k points, ~12k links) with a control panel to explore the link-style
 * options at scale: switch the stroke pattern (solid / dashed / dotted), toggle the
 * endpoint-color gradient, arrows, and `scaleLinksOnZoom`. Points are colored by angular
 * sector, so gradient links visibly blend between their endpoints' colors.
 */
export const interactiveLinkStyles = (): { div: HTMLDivElement; graph: Graph; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const spaceSize = 4096
  const { pointPositions, pointColors, pointSizes, links } = generateHyperbolicGraph({
    nodeCount: 5000,
    avgDegree: 5,
    alpha: 0.75,
    spaceSize,
    seed: 42,
  })
  const linkCount = links.length / 2

  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#16161c',
    enableSimulation: true,
    // The simulation lays the graph out; `scalePointsOnZoom` keeps points readable
    // across zoom levels while the link styles are being compared.
    scalePointsOnZoom: true,
    pointDefaultSize: 1.5,
    linkDefaultColor: '#5F74C2',
    simulationCollision: 0.25,
    simulationCollisionPadding: 2,
    simulationFriction: 0.35,
    linkDefaultWidth: 1,
    linkOpacity: 0.9,
    linkBlending: true,
    // Link-style options exercised by the control panel:
    linkDashLength: 2,
    linkDashGap: 2,
    scaleLinksOnZoom: false,
    linkColorInterpolateFromEndpoints: false,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(div, config)

  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setPointSizes(pointSizes)
  graph.setLinks(links)

  // Stroke pattern is per-link; apply the currently selected one to every link.
  let currentStyle = LinkStyle.Solid
  const applyStyle = (): void => {
    graph.setLinkStyles(new Float32Array(linkCount).fill(currentStyle))
    graph.render()
  }

  applyStyle()

  div.appendChild(buildControls({
    onStyleChange: (style) => { currentStyle = style; applyStyle() },
    onGradientChange: (on) => { graph.setConfigPartial({ linkColorInterpolateFromEndpoints: on }); graph.render() },
    onCurvedChange: (on) => { graph.setConfigPartial({ curvedLinks: on }); graph.render() },
    onArrowsChange: (on) => { graph.setLinkArrows(new Array(linkCount).fill(on)); graph.render() },
    onScaleOnZoomChange: (on) => { graph.setConfigPartial({ scaleLinksOnZoom: on }); graph.render() },
  }))

  return { div, graph }
}
