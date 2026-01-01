/**
 * Creates and appends an error message element to the container
 * @param container The HTML element to append the error message to
 * @returns The created error div element
 */
export function createWebGLErrorMessage (container: HTMLElement, error: string): HTMLDivElement {
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = `
    color: var(--cosmosgl-error-message-color);
    padding: 0em 2em;
    position: absolute;
    top: 50%; left: 0; right: 0;
    transform: translateY(-50%);
    z-index: 1000;
    font-family: inherit;
    font-size: 1rem;
    text-align: center;
    user-select: none;
  `
  errorDiv.textContent = `Sorry, your device or browser does not support the required WebGL features for this visualization: ${error}`
  container.appendChild(errorDiv)
  return errorDiv
}
