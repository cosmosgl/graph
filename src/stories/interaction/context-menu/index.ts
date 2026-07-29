import { Graph, PointShape, LinkStyle, getRgbaColor } from '@cosmos.gl/graph'
import {
  generateContextMenuData,
  basePointColor,
  POINT_COUNT,
  BASE_LINK_COLOR,
  BASE_POINT_SIZE,
  BASE_LINK_WIDTH,
} from './data-gen'
import { createContextMenu, MenuSpec } from './menu'
import './style.css'

/**
 * Context Menu — right-click anything and restyle it.
 *
 * • Point      → colour, shape, size
 * • Link       → colour, stroke pattern, width
 * • Background → gradient and curved links, randomise, reset
 *
 * The callbacks fire as a chain: `onContextMenu` first for every trigger, then
 * exactly one of `onPointContextMenu`, `onLinkContextMenu` or
 * `onBackgroundContextMenu`. The hint bar names the pair that just fired, and
 * on touch a long press does the same.
 *
 * Links are gradients by default, blending between their endpoints' colours,
 * so recolouring a point restyles its links. `setLinkColors` is ignored while
 * that is on — which is why the link menu greys its swatches out.
 */

const PALETTE = ['#FF6B6B', '#FFD166', '#06D6A0', '#4CC9F0', '#B388FF', '#FF8FC7']

const SHAPES: { name: string; glyph: string; value: PointShape }[] = [
  { name: 'Circle', glyph: '●', value: PointShape.Circle },
  { name: 'Square', glyph: '■', value: PointShape.Square },
  { name: 'Triangle', glyph: '▲', value: PointShape.Triangle },
  { name: 'Diamond', glyph: '◆', value: PointShape.Diamond },
  { name: 'Pentagon', glyph: '⬟', value: PointShape.Pentagon },
  { name: 'Hexagon', glyph: '⬢', value: PointShape.Hexagon },
  { name: 'Star', glyph: '★', value: PointShape.Star },
  { name: 'Cross', glyph: '✚', value: PointShape.Cross },
]

const SHAPE_VALUES = SHAPES.map((shape) => shape.value)

const LINK_STYLES: { name: string; value: LinkStyle }[] = [
  { name: 'Solid', value: LinkStyle.Solid },
  { name: 'Dashed', value: LinkStyle.Dashed },
  { name: 'Dotted', value: LinkStyle.Dotted },
]

const POINT_SIZES = [12, 18, 26, 36]
const LINK_WIDTHS = [1, 3, 6, 10]

/** Random element, non-empty by construction — keeps the callers free of
 * index-access fallbacks that would read as if the arrays might be empty. */
function pick<T> (items: readonly T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback
}

export const contextMenu = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.className = 'context-menu-story'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'cm-graph'
  div.appendChild(graphDiv)

  const hint = document.createElement('div')
  hint.className = 'cm-hint'
  hint.innerHTML = '<b>Right-click</b> a point, a link, or the background'
  div.appendChild(hint)

  const menu = createContextMenu(div)

  const { pointPositions, links } = generateContextMenuData()
  const linkCount = links.length / 2

  // Per-element style state. Every menu choice edits one slot of these and
  // hands the whole array back to the engine.
  const pointColors = new Float32Array(POINT_COUNT * 4)
  const pointShapes = new Float32Array(POINT_COUNT)
  const pointSizes = new Float32Array(POINT_COUNT)
  const linkColors = new Float32Array(linkCount * 4)
  const linkStyles = new Float32Array(linkCount)
  const linkWidths = new Float32Array(linkCount)

  // Whole-graph toggles live in config rather than in the per-element arrays.
  let gradientLinks = true
  let curvedLinks = true
  // What `onContextMenu` reported, held so the specific callback that runs
  // straight after can show the pair together.
  let lastGeneric = 'onContextMenu'
  // Where the open menu was anchored, so a chip can rebuild it in place.
  let lastMenuAt = { x: 0, y: 0 }

  function paintPoint (index: number, color: string): void {
    const [r, g, b, a] = getRgbaColor(color)
    pointColors[index * 4] = r
    pointColors[index * 4 + 1] = g
    pointColors[index * 4 + 2] = b
    pointColors[index * 4 + 3] = a
  }

  function paintLink (index: number, color: string): void {
    const [r, g, b, a] = getRgbaColor(color)
    linkColors[index * 4] = r
    linkColors[index * 4 + 1] = g
    linkColors[index * 4 + 2] = b
    linkColors[index * 4 + 3] = a
  }

  function resetAll (): void {
    for (let i = 0; i < POINT_COUNT; i += 1) {
      paintPoint(i, basePointColor(i))
      pointShapes[i] = PointShape.Circle
      pointSizes[i] = BASE_POINT_SIZE
    }
    for (let i = 0; i < linkCount; i += 1) {
      paintLink(i, BASE_LINK_COLOR)
      linkStyles[i] = LinkStyle.Solid
      linkWidths[i] = BASE_LINK_WIDTH
    }
  }

  function commit (): void {
    graph.setPointColors(pointColors)
    graph.setPointShapes(pointShapes)
    graph.setPointSizes(pointSizes)
    graph.setLinkColors(linkColors)
    graph.setLinkStyles(linkStyles)
    graph.setLinkWidths(linkWidths)
    graph.render()
  }

  function showChain (first: string, second: string): void {
    hint.innerHTML = `<span class="cm-fired">${first}</span> → <span class="cm-fired">${second}</span>`
  }

  function notify (message: string): void {
    hint.innerHTML = message
  }

  function openMenu (spec: MenuSpec, event: MouseEvent): void {
    lastMenuAt = { x: event.clientX, y: event.clientY }
    menu.open(spec, event.clientX, event.clientY)
  }

  function setGradientLinks (on: boolean): void {
    gradientLinks = on
    graph.setConfigPartial({ linkColorInterpolateFromEndpoints: on })
  }

  function setCurvedLinks (on: boolean): void {
    curvedLinks = on
    graph.setConfigPartial({ curvedLinks: on })
  }

  function pointMenu (index: number): MenuSpec {
    return {
      title: `Point ${index}`,
      subtitle: 'onPointContextMenu',
      rows: [
        {
          // While the gradient is on, every link touching this point is
          // re-derived from its colour — worth saying, because it is the most
          // surprising thing that happens when you pick a swatch here.
          label: gradientLinks ? 'Colour — its links follow' : 'Colour',
          chips: PALETTE.map((color) => ({
            swatch: color,
            title: color,
            onSelect: (): void => { paintPoint(index, color); commit() },
          })),
        },
        {
          label: 'Shape',
          chips: SHAPES.map((shape) => ({
            label: shape.glyph,
            title: shape.name,
            active: pointShapes[index] === shape.value,
            onSelect: (): void => { pointShapes[index] = shape.value; commit() },
          })),
        },
        {
          label: 'Size',
          chips: POINT_SIZES.map((size) => ({
            label: String(size),
            active: pointSizes[index] === size,
            onSelect: (): void => { pointSizes[index] = size; commit() },
          })),
        },
        {
          label: '',
          chips: [{
            label: 'Reset point',
            onSelect: (): void => {
              paintPoint(index, basePointColor(index))
              pointShapes[index] = PointShape.Circle
              pointSizes[index] = BASE_POINT_SIZE
              commit()
            },
          }],
        },
      ],
    }
  }

  function linkMenu (index: number): MenuSpec {
    return {
      title: `Link ${index}`,
      subtitle: 'onLinkContextMenu',
      rows: [
        {
          // An explicit colour and the endpoint gradient are alternatives, not
          // layers — the engine ignores setLinkColors while it interpolates
          // from endpoints. So the swatches are inert here rather than quietly
          // switching a whole-graph setting off on behalf of one link. They
          // stay visible, greyed, next to the switch that makes them usable.
          label: gradientLinks ? 'Colour — set by the endpoints' : 'Colour',
          chips: [
            ...PALETTE.map((color) => ({
              swatch: color,
              title: gradientLinks
                ? 'Unavailable while links are gradients — their colour comes from the two points they join'
                : color,
              disabled: gradientLinks,
              onSelect: (): void => { paintLink(index, color); commit() },
            })),
            ...(gradientLinks
              ? [{
                label: 'Turn gradient off',
                title: 'linkColorInterpolateFromEndpoints — affects every link',
                keepOpen: true,
                onSelect: (): void => {
                  setGradientLinks(false)
                  commit()
                  notify('Gradient off — link colours now come from <span class="cm-fired">setLinkColors</span>')
                  menu.open(linkMenu(index), lastMenuAt.x, lastMenuAt.y)
                },
              }]
              : []),
          ],
        },
        {
          label: 'Stroke',
          chips: LINK_STYLES.map((style) => ({
            label: style.name,
            active: linkStyles[index] === style.value,
            onSelect: (): void => { linkStyles[index] = style.value; commit() },
          })),
        },
        {
          label: 'Width',
          chips: LINK_WIDTHS.map((width) => ({
            label: String(width),
            active: linkWidths[index] === width,
            onSelect: (): void => { linkWidths[index] = width; commit() },
          })),
        },
        {
          label: '',
          chips: [{
            label: 'Reset link',
            onSelect: (): void => {
              paintLink(index, BASE_LINK_COLOR)
              linkStyles[index] = LinkStyle.Solid
              linkWidths[index] = BASE_LINK_WIDTH
              commit()
            },
          }],
        },
      ],
    }
  }

  function backgroundMenu (): MenuSpec {
    return {
      title: 'Background',
      subtitle: 'onBackgroundContextMenu',
      rows: [
        {
          label: 'Whole graph',
          chips: [
            {
              label: 'Gradient links',
              active: gradientLinks,
              title: 'linkColorInterpolateFromEndpoints — links blend between their endpoint colours',
              onSelect: (): void => {
                setGradientLinks(!gradientLinks)
                graph.render()
              },
            },
            {
              label: 'Curved links',
              active: curvedLinks,
              onSelect: (): void => {
                setCurvedLinks(!curvedLinks)
                graph.render()
              },
            },
          ],
        },
        {
          label: '',
          chips: [
            {
              label: 'Surprise me',
              title: 'Random colour and shape for every point',
              onSelect: (): void => {
                for (let i = 0; i < POINT_COUNT; i += 1) {
                  paintPoint(i, pick(PALETTE, BASE_LINK_COLOR))
                  pointShapes[i] = pick(SHAPE_VALUES, PointShape.Circle)
                }
                // Only worth randomising link colours when they are actually
                // the thing being drawn; under a gradient they follow the
                // points, and writing them here would contradict the link
                // menu, which refuses to set them for exactly that reason.
                if (!gradientLinks) {
                  for (let i = 0; i < linkCount; i += 1) paintLink(i, pick(PALETTE, BASE_LINK_COLOR))
                }
                commit()
              },
            },
            {
              label: 'Reset all',
              // Restores the config toggles too, not just the per-element
              // arrays — otherwise "reset" leaves the graph in a state the
              // story never starts in.
              onSelect: (): void => {
                resetAll()
                setGradientLinks(true)
                setCurvedLinks(true)
                commit()
              },
            },
          ],
        },
      ],
    }
  }

  const graph = new Graph(graphDiv, {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    // A settled layout: you cannot reliably right-click a moving target, and
    // link picking resolves only on a graph created with the simulation off.
    enableSimulation: false,
    enableDrag: false,
    curvedLinks,
    linkColorInterpolateFromEndpoints: gradientLinks,
    pointDefaultSize: BASE_POINT_SIZE,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    linkDefaultWidth: BASE_LINK_WIDTH,
    hoveredLinkColor: '#ffffff',
    hoveredLinkWidthIncrease: 3,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',

    // Fires for every context-menu trigger, before the specific one below.
    // `index` is the point under the cursor, or undefined for a link or the
    // background — the same value the engine uses to pick which one runs next.
    // The engine has already called preventDefault(), so the browser's own
    // menu never appears and there is nothing to suppress here.
    onContextMenu: (index?: number): void => {
      lastGeneric = index === undefined
        ? 'onContextMenu(undefined)'
        : `onContextMenu(${index})`
    },
    onPointContextMenu: (index: number, _position: [number, number], event: MouseEvent): void => {
      showChain(lastGeneric, 'onPointContextMenu')
      openMenu(pointMenu(index), event)
    },
    onLinkContextMenu: (index: number, event: MouseEvent): void => {
      showChain(lastGeneric, 'onLinkContextMenu')
      openMenu(linkMenu(index), event)
    },
    onBackgroundContextMenu: (event: MouseEvent): void => {
      showChain(lastGeneric, 'onBackgroundContextMenu')
      openMenu(backgroundMenu(), event)
    },

    onClick: (): void => menu.close(),
    onZoomStart: (): void => menu.close(),
  })

  resetAll()
  graph.setPointPositions(pointPositions)
  graph.setLinks(links)
  commit()
  graph.fitView(0)

  function onKeyDown (event: KeyboardEvent): void {
    if (event.key === 'Escape') menu.close()
  }
  document.addEventListener('keydown', onKeyDown)

  return {
    div,
    graph,
    // The graph itself is torn down by the story harness; this is for the
    // document-level listener and the menu element, which it does not own.
    destroy: (): void => {
      document.removeEventListener('keydown', onKeyDown)
      menu.destroy()
    },
  }
}
