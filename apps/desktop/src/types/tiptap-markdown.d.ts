/**
 * `tiptap-markdown` (0.9.0) ships `index.d.ts` with no module augmentation of
 * `@tiptap/core`'s `Storage` interface — it only exports the `Markdown`
 * extension's own option/storage types. Without this, `editor.storage.markdown`
 * has no type anywhere in the program; it isn't a resolution quirk, the
 * package genuinely doesn't declare it. This file supplies the augmentation
 * ourselves so `editor.storage.markdown.getMarkdown()` type-checks.
 */
import type { MarkdownStorage } from 'tiptap-markdown'

declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage
  }
}
