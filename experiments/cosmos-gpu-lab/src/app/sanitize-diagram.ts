import DOMPurify from 'dompurify'

export function sanitizeDiagram (svg: string): DocumentFragment {
  return DOMPurify.sanitize(svg, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    // Mermaid places HTML labels inside SVG foreignObject elements. Allow the
    // namespace transition while still sanitizing every descendant and URL.
    ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  })
}
