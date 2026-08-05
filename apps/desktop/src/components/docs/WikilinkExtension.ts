import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]` — single line only. */
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g

export interface WikilinkOptions {
  onClick: (target: string) => void
}

/**
 * Decorates `[[wikilinks]]` in the editor body and routes clicks to `onClick`
 * with the raw inner text (alias and heading fragment included — the caller
 * normalises). Decoration-based rather than a node type, so the underlying
 * markdown text is never rewritten: what's on disk stays exactly what Obsidian
 * wrote.
 */
export const Wikilink = Extension.create<WikilinkOptions>({
  name: 'wikilink',

  addOptions() {
    return { onClick: () => {} }
  },

  addProseMirrorPlugins() {
    const onClick = this.options.onClick
    return [
      new Plugin({
        key: new PluginKey('wikilink'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              WIKILINK_RE.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = WIKILINK_RE.exec(node.text)) !== null) {
                const from = pos + match.index
                decorations.push(
                  Decoration.inline(from, from + match[0].length, {
                    class: 'text-accent-blue cursor-pointer hover:underline',
                    'data-wikilink': match[1],
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },

          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-wikilink]')
            const target = el?.getAttribute('data-wikilink')
            if (!target) return false
            onClick(target)
            return true
          },
        },
      }),
    ]
  },
})
