export type MenuChip = {
  /** Text shown on the chip. Omit when `swatch` carries the meaning. */
  label?: string;
  /** Renders the chip as a colour swatch instead of a text button. */
  swatch?: string;
  /** Hover tooltip — worth setting whenever the label is a bare glyph. */
  title?: string;
  active?: boolean;
  /** Shown, but greyed and inert. Use it to keep an unavailable choice
   * visible with a `title` saying why, rather than hiding the capability. */
  disabled?: boolean;
  /** Leave the menu open after selecting, for chips that rebuild it in place. */
  keepOpen?: boolean;
  onSelect: () => void;
}

export type MenuRow = { label: string; chips: MenuChip[] }
export type MenuSpec = { title: string; subtitle?: string; rows: MenuRow[] }

/**
 * A small DOM context menu anchored to the cursor.
 *
 * Kept separate from the story so the story file reads as "which callback
 * builds which menu" rather than as menu plumbing.
 */
export function createContextMenu (container: HTMLElement): {
  open: (spec: MenuSpec, clientX: number, clientY: number) => void;
  close: () => void;
  destroy: () => void;
  } {
  const root = document.createElement('div')
  root.className = 'cm-menu'
  root.style.display = 'none'
  container.appendChild(root)

  function close (): void {
    root.style.display = 'none'
  }

  function open (spec: MenuSpec, clientX: number, clientY: number): void {
    root.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'cm-header'
    header.textContent = spec.title
    root.appendChild(header)

    if (spec.subtitle) {
      const sub = document.createElement('div')
      sub.className = 'cm-subtitle'
      sub.textContent = spec.subtitle
      root.appendChild(sub)
    }

    for (const row of spec.rows) {
      const rowEl = document.createElement('div')
      rowEl.className = 'cm-row'

      const label = document.createElement('div')
      label.className = 'cm-row-label'
      label.textContent = row.label
      rowEl.appendChild(label)

      const chipsEl = document.createElement('div')
      chipsEl.className = 'cm-chips'
      for (const chip of row.chips) {
        const el = document.createElement('button')
        el.className = chip.swatch ? 'cm-chip cm-swatch' : 'cm-chip'
        if (chip.active) el.classList.add('is-active')
        if (chip.swatch) el.style.background = chip.swatch
        if (chip.label) el.textContent = chip.label
        if (chip.title) el.title = chip.title
        if (chip.disabled) el.disabled = true
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          if (chip.disabled) return
          chip.onSelect()
          if (!chip.keepOpen) close()
        })
        chipsEl.appendChild(el)
      }
      rowEl.appendChild(chipsEl)
      root.appendChild(rowEl)
    }

    // Measure before placing, so a menu opened near the right or bottom edge
    // flips back inside the container instead of being clipped by it.
    const bounds = container.getBoundingClientRect()
    root.style.display = 'block'
    root.style.left = '0px'
    root.style.top = '0px'
    const { width, height } = root.getBoundingClientRect()

    let x = clientX - bounds.left
    let y = clientY - bounds.top
    if (x + width > bounds.width) x = Math.max(0, x - width)
    if (y + height > bounds.height) y = Math.max(0, y - height)

    root.style.left = `${x}px`
    root.style.top = `${y}px`
  }

  // A click inside the menu is handled by the chip and stopped there; anything
  // else that reaches the menu root is a miss, so treat it as dismiss.
  root.addEventListener('click', close)

  return { open, close, destroy: () => root.remove() }
}
