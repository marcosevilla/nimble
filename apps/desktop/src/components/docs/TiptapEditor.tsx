import { useEditor, EditorContent, ReactRenderer, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy, { type Instance } from 'tippy.js'
import { CheckSquare, FileText } from 'lucide-react'
import { Wikilink } from './WikilinkExtension'

interface TiptapEditorProps {
  content: string
  /**
   * Omit to render read-only. Its absence is the single source of truth for
   * editability: the editor is created with `editable: false`, no `onUpdate`
   * handler is installed, and nothing is flushed on unmount — so there is no
   * callback a change could reach even if one were somehow produced.
   *
   * Vault notes rely on this: `tiptap-markdown` does not round-trip Obsidian's
   * dialect losslessly (frontmatter, wikilinks, embeds, checkboxes, callouts),
   * so serialising one back to disk would corrupt it.
   */
  onChange?: (html: string) => void
  placeholder?: string
  format?: 'html' | 'markdown'
  /** When provided, `[[wikilinks]]` become clickable and route here. */
  onWikilinkClick?: (target: string) => void
}

// ── Mention item type (tasks + docs) ──

interface MentionItem {
  id: string
  label: string
  kind: 'task' | 'doc'
}

// ── Mention suggestion list ──

interface MentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const MentionList = forwardRef<MentionListRef, SuggestionProps<MentionItem>>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + props.items.length) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % props.items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = props.items[selectedIndex]
        if (item) props.command(item)
        return true
      }
      return false
    },
  }))

  if (props.items.length === 0) return null

  return (
    <div className="w-56 rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
      {props.items.map((item, i) => (
        <button
          key={`${item.kind}-${item.id}`}
          onClick={() => props.command(item)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body transition-colors',
            i === selectedIndex ? 'bg-accent/40' : 'hover:bg-accent/20',
          )}
        >
          {item.kind === 'task' ? (
            <CheckSquare className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  )
})
MentionList.displayName = 'MentionList'

// ── Main editor ──

export function TiptapEditor({ content, onChange, placeholder = 'Start writing...', format, onWikilinkClick }: TiptapEditorProps) {
  const dp = useDataProvider()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const editable = !!onChange

  const serialize = (editor: Editor) =>
    format === 'markdown' ? editor.storage.markdown.getMarkdown() : editor.getHTML()

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.extend({ name: 'link' }).configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-accent-blue underline cursor-pointer' },
      }),
      // A read-only pane has nowhere to start writing — no placeholder.
      ...(editable ? [Placeholder.configure({ placeholder })] : []),
      ...(format === 'markdown'
        ? [Markdown.configure({ html: false, linkify: true, breaks: false })]
        : []),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention-tag',
        },
        suggestion: {
          items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
            try {
              const q = query.toLowerCase()
              const [tasks, docs] = await Promise.all([
                dp.tasks.list({ includeCompleted: false }),
                q.length > 0 ? dp.docs.searchDocuments(query) : Promise.resolve([]),
              ])
              const taskItems: MentionItem[] = tasks
                .filter((t) => !t.parent_id && t.content.toLowerCase().includes(q))
                .slice(0, 5)
                .map((t) => ({ id: t.id, label: t.content, kind: 'task' }))
              const docItems: MentionItem[] = docs
                .slice(0, 3)
                .map((d) => ({ id: d.id, label: d.title || 'Untitled', kind: 'doc' }))
              return [...taskItems, ...docItems]
            } catch {
              return []
            }
          },
          render: () => {
            let component: ReactRenderer<MentionListRef> | null = null
            let popup: Instance[] | null = null

            return {
              onStart: (props: SuggestionProps<MentionItem>) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                })

                if (!props.clientRect) return

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                })
              },
              onUpdate: (props: SuggestionProps<MentionItem>) => {
                component?.updateProps(props)
                if (popup && props.clientRect) {
                  popup[0]?.setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect,
                  })
                }
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide()
                  return true
                }
                return component?.ref?.onKeyDown(props) ?? false
              },
              onExit: () => {
                popup?.[0]?.destroy()
                component?.destroy()
              },
            }
          },
        },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      }),
      ...(onWikilinkClick ? [Wikilink.configure({ onClick: onWikilinkClick })] : []),
    ],
    content,
    editorProps: {
      attributes: {
        // leading-relaxed is a deliberate prose override — editor body needs reading leading, not UI leading
        class: 'tiptap-editor outline-none min-h-[200px] text-body leading-relaxed',
      },
    },
    onUpdate: onChange
      ? ({ editor }) => {
          clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => {
            onChange(serialize(editor))
          }, 1000)
        }
      : undefined,
  })

  useEffect(() => {
    if (editor && content !== serialize(editor)) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  useEffect(() => {
    if (!onChange) return
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        if (editor) onChange(serialize(editor))
      }
    }
  }, [editor, onChange])

  if (!editor) return null

  return <EditorContent editor={editor} />
}
