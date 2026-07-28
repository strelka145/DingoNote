// Shared dropdown for the `/` slash command and the `[[` wikilink
// autocomplete (§3-4). Both previously hand-rolled an identical popup: a
// `.slash-menu` div appended to <body>, rows with hover/click, keyboard
// next/prev, and viewport-aware positioning. The only differences are the
// row contents and the empty-state text, which callers supply.

export interface SuggestionMenuOptions<T> {
  emptyText: string
  // Fill a `.slash-item` row's inner content for one item. The row's active
  // class, hover highlight, and click wiring are handled by the menu.
  renderRow: (item: T, row: HTMLElement) => void
  onPick: (item: T) => void
}

export class SuggestionMenu<T> {
  el: HTMLDivElement
  items: T[] = []
  selected = 0

  constructor(private opts: SuggestionMenuOptions<T>) {
    this.el = document.createElement('div')
    this.el.className = 'slash-menu'
    this.el.style.display = 'none'
    // Block focus-stealing on any mousedown inside the popup so the editor
    // selection (and the blinking caret) stays alive while interacting.
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    document.body.appendChild(this.el)
  }

  setOnPick(fn: (item: T) => void) {
    this.opts.onPick = fn
  }

  show(items: T[], rect: DOMRect | null) {
    this.items = items
    this.selected = 0
    this.render()
    if (rect) this.position(rect)
    this.el.style.display = ''
  }

  update(items: T[], rect: DOMRect | null) {
    this.items = items
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1))
    this.render()
    if (rect) this.position(rect)
  }

  position(rect: DOMRect) {
    const { innerHeight, innerWidth } = window
    const menuH = this.el.offsetHeight || 200
    const menuW = this.el.offsetWidth || 240
    let top = rect.bottom + 4
    if (top + menuH > innerHeight - 8) top = rect.top - menuH - 4
    let left = rect.left
    if (left + menuW > innerWidth - 8) left = innerWidth - menuW - 8
    this.el.style.top = `${Math.max(8, top)}px`
    this.el.style.left = `${Math.max(8, left)}px`
  }

  render() {
    this.el.innerHTML = ''
    if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'slash-empty'
      empty.textContent = this.opts.emptyText
      this.el.appendChild(empty)
      return
    }
    this.items.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = 'slash-item' + (i === this.selected ? ' active' : '')
      row.dataset.idx = String(i)
      this.opts.renderRow(item, row)
      row.addEventListener('mouseenter', () => this.highlight(i))
      row.addEventListener('click', () => this.opts.onPick(item))
      this.el.appendChild(row)
    })
  }

  highlight(i: number) {
    if (i === this.selected) return
    this.selected = i
    this.el.querySelectorAll('.slash-item').forEach((el, idx) => {
      el.classList.toggle('active', idx === i)
    })
  }

  next() {
    if (!this.items.length) return
    this.selected = (this.selected + 1) % this.items.length
    this.render()
  }
  prev() {
    if (!this.items.length) return
    this.selected = (this.selected - 1 + this.items.length) % this.items.length
    this.render()
  }
  current(): T | undefined {
    return this.items[this.selected]
  }
  hide() {
    this.el.style.display = 'none'
  }
  destroy() {
    this.el.remove()
  }
}

// Wire a SuggestionMenu into the render lifecycle @tiptap/suggestion expects.
// onStart/onUpdate/onKeyDown/onExit are identical for both menus.
export function suggestionRenderer<T>(opts: {
  emptyText: string
  renderRow: (item: T, row: HTMLElement) => void
}) {
  return () => {
    let menu: SuggestionMenu<T> | null = null
    let latest: any = null
    return {
      onStart: (props: any) => {
        latest = props
        menu = new SuggestionMenu<T>({
          emptyText: opts.emptyText,
          renderRow: opts.renderRow,
          onPick: (item) => props.command(item),
        })
        menu.show(props.items, props.clientRect?.() ?? null)
      },
      onUpdate: (props: any) => {
        latest = props
        if (!menu) return
        menu.setOnPick((item) => props.command(item))
        menu.update(props.items, props.clientRect?.() ?? null)
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (!menu) return false
        if (event.key === 'ArrowDown') {
          menu.next()
          return true
        }
        if (event.key === 'ArrowUp') {
          menu.prev()
          return true
        }
        if (event.key === 'Enter') {
          const item = menu.current()
          if (item !== undefined && latest) {
            latest.command(item)
            return true
          }
        }
        if (event.key === 'Escape') {
          menu.hide()
          return true
        }
        return false
      },
      onExit: () => {
        menu?.destroy()
        menu = null
      },
    }
  }
}
