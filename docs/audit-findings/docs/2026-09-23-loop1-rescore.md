# Docs — Loop 1 re-score (2026-09-23)
Baseline: 2026-09-22-loop1.md · Screenshots: loop1-rescore/docs-{light,dark}.png, loop1-rescore/shell-help-{light,dark}.png (Docs tree open in the nav while on Today) · compared against loop1-before/docs-*.png

Code checked on main at `988d048`. No browser was used. The rescore set only has the empty "no document" state. Native doc, vault note, search results, hover and focus states are judged from code, and each such row below says so. Contrast values come from the warm tokens in `themes.css` (oklch L → luminance), using the same method as the baseline.

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 3/5 | 3/5 | Native and vault views now share one `PageColumn` (DocEditor.tsx:144, VaultNoteEditor.tsx:107), tree rows are 32px on the grid, hover is visible (`--hover` 1.19:1). The selected row's `bg-muted` measures 1.06:1 on `--sidebar` (light and dark), so it's fainter than hover. The title still ties body H1 at 20px/600, and the editor measure grew to 720px (~116 chars). Editor alpha hacks are unchanged. |
| Interaction | 2/5 | 3/5 | On the Docs page the tree is a full roving tree (FolderTree.tsx:27-63). Search takes ↑/↓/Enter (DocsSearch.tsx:82-88), and `N`, `/`, inline delete confirm and 32px hit areas all work. With the tree in the nav, though, arrow keys in it also drive the Inbox/Tasks row lists (N-P1-1), and the `/` hint is dead on every page except Docs. |
| UX | 3/5 | 4/5 | Read-only shows with a lock and sits next to the path, frontmatter is a chip row, the empty state says "Nothing open" with a New document button + `N`, and Help has a Docs section that explains the `/doc` scope. Still open: "New folder" is below the fold under the vault with no other entry point, the Vault header is still one step subordinate, and the sync banner sits on every page. |
| Accessibility | 2/5 | 3/5 | Semantics now exist: tree/treeitem with `aria-selected`/`aria-expanded`, combobox/listbox with `aria-activedescendant`, every icon button named, a 2px ring at 4.23:1/6.14:1, and reduced motion zeroes the tokens. Still failing: editor text contrast (blockquote 2.45:1 light, placeholder 1.34:1), selected fill 1.06:1, tree groups not owned by their items, and focus stolen by the page list off-Docs (N-P1-1). |

Average: 2.5 → 3.25

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | Tree not keyboard-drivable | Fixed | Rows are `<button role="treeitem">` with roving `tabIndex` (FolderTree.tsx:261-273, :203-224). One handler covers ↑↓ Home End ←→ ⌫ (:27-63), and Enter/Space is the native click. `N` is at DocsPage.tsx:40-45, registered at lib/shortcuts.ts:117-122. Code only, not re-run in a harness. The off-page regression is filed separately as N-P1-1. |
| P1-2 | Search results no keyboard path | Fixed | ↑/↓/Enter/Escape at DocsSearch.tsx:82-88. `role="combobox"` + `aria-activedescendant` at :104-108, `role="option" aria-selected` at :129-130. The active hit gets `bg-muted` + `text-meta-strong` (:136-139). Code only. |
| P1-3 | Selected/hover invisible | Partly | Hover is fixed: `hover:bg-hover` (FolderTree.tsx:260, :313, :379, :496), 1.19:1 light / 1.23:1 dark per themes.css:30, :85. Selected is still weak: `bg-muted` (:260, :536) sits on `--sidebar` (themes.css:54, dark `--card` :74) at 1.06:1 light / 1.07:1 dark. That's below the 1.15 floor themes.css:29 sets and now fainter than hover. Weight (`text-meta-strong`, :273, :548) is the only reliable cue. |
| P2-1 | Read-only stated, not shown | Fixed | Lock glyph + "Read-only · edited in Obsidian" next to the path (VaultNoteEditor.tsx:110-115). Body is `cursor-default select-text` + `aria-readonly` (:136). |
| P2-2 | Frontmatter renders as heading | Fixed | `splitFrontmatter` (lib/frontmatter.ts:22, tested) feeds only `body` to the editor (VaultNoteEditor.tsx:39, :139). Fields render as `text-label` chips (:116-128). |
| P2-3 | Two page layouts | Fixed | Both use `PageColumn width="wide" className="space-y-4"` (DocEditor.tsx:144, VaultNoteEditor.tsx:107), and the path sits in the eyebrow slot (:110). The title model still differs (input vs in-body H1), which is inherent to read-only. |
| P2-4 | Row spec differs from Tasks sidebar | Partly | Docs rows are now `h-8` (32px) with foreground text (FolderTree.tsx:20). But the Tasks tree rows in the **same nav column** are `h-9` with `hover:bg-muted/50` (ProjectSidebar.tsx:124-126, :191-192), against Docs `h-8` + `hover:bg-hover`. Two row specs now sit stacked in one sidebar. |
| P2-5 | Delete: no confirm, no undo | Partly (confirm Fixed; undo Deferred) | Inline `Delete {name}?` alertdialog with autofocused confirm and Escape back to the row (FolderTree.tsx:226-252). ⌫ asks first (:57-60, :196-201). Undo is queued as Rust soft-delete (loop1-plan "Queued for Marco" #9, NEXT.md Rust queue). |
| P2-6 | Empty state passive | Fixed | `EmptyState` "Nothing open. Pick something from the tree, or start a new document." + outline New document button + `N` kbd (DocEditor.tsx:111-137). Screens: loop1-rescore/docs-light.png, docs-dark.png. The optional "auto-open most recent doc" wasn't taken. |
| P2-7 | Vault section subordinate | Partly | Folder glyphs now swap on expand in both halves (FolderTree.tsx:329, :512). Still open: the Vault header is `text-label text-muted-foreground` (:390) while native folders are `text-meta` foreground (:326), and there's no matching header for the native block. "New document"/"New folder" still render after the whole vault subtree (:426-464), so in the nav they're now below the fold (see N-P2-2). |
| P2-8 | Missing semantics and names | Fixed | Every icon button now has an `aria-label` (FolderTree.tsx:282, :337, :346, :402; DocsSearch.tsx:112; DocNoteEntry.tsx:24). "Add a note…" is a `<button>` (DocEditor.tsx:216-222), and rows are buttons. The remaining structural gaps are filed as N-P3-1. |
| P2-9 | Focus ring fails contrast | Fixed | Global `:focus-visible { outline: 2px solid var(--ring) }` (index.css:133-136). `--ring` is 4.23:1 light / 6.14:1 dark (themes.css:36, :91). Tree rows are real buttons, so they inherit it. Code only. |
| P2-10 | Search has no shortcut / help mismatch | Fixed | `/` focuses search and reopens a closed nav tree first (DocsPage.tsx:46-62). Help has a Docs section: "/ — Search docs and vault (⌘K /doc searches native docs only)" (lib/shortcuts.ts:123). The off-page side effect is filed as N-P2-1. |
| P3-1 | Title = body H1 size | Open | Title input `text-display` (DocEditor.tsx:157) vs `.tiptap-editor h1` `--text-display` (index.css:351-354). |
| P3-2 | Measure ~100 chars | Open (worse) | The column is now `max-w-page-wide` = 768px (PageFrame.tsx:9, index.css:60) − `px-6`, so 720px of text, about 116 chars at 13px. There's no `ch` cap on the editor (TiptapEditor.tsx:232). |
| P3-3 | Dim editor chrome illegible | Open | Marker /0.7 (index.css:397-399), blockquote /0.7 (:403-409), `hr` border /0.2 (:428-432), placeholder /0.3 (:433-439). The measured pairs are unchanged from the baseline. |
| P3-4 | `transition-all` on note delete | Fixed | `transition-[opacity,color,background-color] duration-(--transition-fast)` (DocNoteEntry.tsx:25). |
| P3-5 | Inline code 0.9em off scale | Open | `code` `font-size: 0.9em` (index.css:414), `.mention-tag` 0.9em (:446), `min-h-[200px]` (TiptapEditor.tsx:232). |
| P3-6 | 16px hover-action targets | Fixed | `ACTION` = `size-6` + `before:-inset-1`, a 32px target (FolderTree.tsx:22), used at :283, :338, :347. DocNoteEntry.tsx:25 matches. |
| P3-7 | No reduced motion | Fixed | `@media (prefers-reduced-motion: reduce)` zeroes `--transition-*` (index.css:565-570). Chevrons use `duration-(--transition-fast)` (FolderTree.tsx:328, :392, :511). |

Tally: 12 Fixed · 4 Partly (one of them part-Deferred) · 4 Open (P3) · 0 fully Deferred.

## New findings

### N-P1-1 Arrow keys in the nav's Docs tree also drive the Inbox/Tasks list and steal focus
- Anchor: `apps/desktop/src/components/docs/FolderTree.tsx:40-41` (↑/↓ `preventDefault` only; Space alone gets `stopPropagation` at :39), `apps/desktop/src/hooks/useTaskNavigation.ts:83-107` (window keydown; the ↑/↓/j/k branch never checks `defaultPrevented`) and `:125-128` (row-action keys), `apps/desktop/src/lib/rowNav.ts:93-104` (a `button` target is handled for every key except Enter/Space), `apps/desktop/src/components/pages/InboxPage.tsx:336-345` (`t`/`m`/`d` row keys), `apps/desktop/src/components/layout/NavSidebar.tsx:214` (tree now mounted in the nav on every page)
- Rubric: §1.5, §3.6
- Screens: light `loop1-rescore/shell-help-light.png` (Docs tree open while on Today), dark `loop1-rescore/shell-help-dark.png`. Traced in code, not reproduced in a browser.
- What's wrong: The tree now lives in the nav, and it stays open on Inbox (and can be opened on Tasks). There, ↓ on a tree row runs both the tree's React handler and the page's window-level `useRowNavigation` handler. The page handler moves its row focus, and its effect then calls `focusRowElement`, pulling DOM focus out of the tree into the list. The page's letter keys also fire from a tree row: `d` dismisses and `t` converts the remembered Inbox capture, and `x` completes the remembered task on Tasks. The Docs page has no row list, so the problem only shows up off-page, which is exactly the use the nav move created.
- Fix: `e.stopPropagation()` for every key `handleTreeKeyDown` handles, or have `decideRowKey` skip targets inside `[role="tree"]`. CROSS-SURFACE (check the Tasks project tree in the same nav, `ProjectSidebar.tsx`, for the same leak).

### N-P2-1 The `/` search hint appears on every page but only works on Docs
- Anchor: `apps/desktop/src/components/docs/DocsSearch.tsx:116` (always-on `<kbd>/</kbd>`), `apps/desktop/src/components/pages/DocsPage.tsx:36-67` (the only `/` binding in `src`, unmounted off Docs), `apps/desktop/src/components/layout/NavSidebar.tsx` "other pages leave both as they were" effect (tree stays open)
- Rubric: §1.5 (shortcuts discoverable and trustworthy)
- Screens: light `loop1-rescore/shell-help-light.png` (`/` chip in the nav search on Today), dark `loop1-rescore/shell-help-dark.png`
- What's wrong: After a visit to Docs, the tree and its `/` chip stay in the nav on Today, Inbox, Goals and Activity, where `/` does nothing. The hint teaches a key that fails on 5 of 7 pages.
- Fix: Move the `/` listener into `NavDocsTree` (active whenever the search is mounted, same `shouldIgnoreKey` guard), or render the chip only when `currentPage === 'docs'`.

### N-P2-2 "New folder" and "New document" sit below the fold in a nav with no scrollbar
- Anchor: `apps/desktop/src/components/docs/FolderTree.tsx:426-464` (both actions render after the vault subtree), `apps/desktop/src/components/layout/NavSidebar.tsx:378` (`overflow-y-auto … [scrollbar-width:none]`); `grep -rn createFolder components stores lib` = 1 site (FolderTree.tsx:142)
- Rubric: §1.5 (discoverability), §1.2
- Screens: light `loop1-rescore/docs-light.png` (tree ends at "resources", no create actions visible), dark `loop1-rescore/docs-dark.png`. Compare `loop1-before/docs-light.png`, where "New folder" was visible under the tree and a `+` sat in the column header.
- What's wrong: The old Docs column header had a `+`, and that went away with the column. Both create actions now come after five vault folders (and after Marco's real 1,104-note vault once it's expanded), inside a scroller with a hidden scrollbar. New document still has `N` and the empty-state button. New folder has no other entry point, no shortcut and no command.
- Fix: Put New document / New folder directly under the search (or as a `+` menu on the Docs nav row) above both trees. This also closes the last part of P2-7.

### N-P2-3 Stale-sync banner is a permanent, undismissable strip on every page
- Anchor: `apps/desktop/src/components/shared/SyncHealthBanner.tsx:66-88` (no dismiss; `bg-warning/5`; stale copy :77), `apps/desktop/src/lib/syncHealth.ts:3`, `:22` (stale = > 1 h), mounted at `apps/desktop/src/components/layout/Dashboard.tsx:293`
- Rubric: §1.4 (earned attention: chrome must not compete with content), §1.2
- Screens: light `loop1-rescore/docs-light.png` (40px strip above the Docs title), dark `loop1-rescore/docs-dark.png`
- What's wrong: The *error* state earns a persistent banner, since that's the R1 silent-401 lesson. The *stale* state doesn't, yet it gets the same treatment: a warning-tinted, full-width 40px strip above every page title that can't be dismissed. It sits above the reading surface the whole time Marco is in Docs. The copy is neutral, so this isn't a §3.1 hit.
- Fix: Keep `error` as is. Make `stale` dismissible until the state changes, or demote it to the nav's status dot. CROSS-SURFACE (shell, all seven pages).

### N-P3-1 Tree semantics are incomplete
- Anchor: `apps/desktop/src/components/docs/FolderTree.tsx:296-300` (`role="tree"`), `:356`, `:411`, `:517` (`role="group"` is a sibling of its treeitem, not owned by it; no `aria-level`), `:367-369` ("Unfiled" text), `:426-464` (New document / New folder / name input inside the tree)
- Rubric: §1.5; craft: better-ui "semantic structure before styling"
- Screens: light `loop1-rescore/docs-light.png`, dark `loop1-rescore/docs-dark.png`
- What's wrong: Screen readers get a flat run of treeitems with no level or parent, plus three non-treeitem controls inside the tree. Keyboard use is fine; the announced structure isn't.
- Fix: Wrap each treeitem and its group in one `role="treeitem"` element (or add `aria-level`/`aria-owns`), and move the create actions and the Unfiled label outside `role="tree"`.

### N-P3-2 Truncated native doc names have no full-name fallback, and the nav costs another indent
- Anchor: `apps/desktop/src/components/docs/FolderTree.tsx:276` (native doc span, no `title`) vs `:540` (vault note has `title={note.path}`), `apps/desktop/src/components/layout/NavSidebar.tsx:214` (`pl-4` under the nav row) + `px-2` at :378
- Rubric: §1.4; craft: better-typography "truncate with a way to see the rest"
- Screens: light `loop1-rescore/docs-light.png` ("Canary check-in case …"), dark `loop1-rescore/docs-dark.png`
- What's wrong: Nested under the nav, the tree starts 16px further in than the old column, and every vault level adds `ml-4`. Deep vault notes keep a path tooltip, but native docs get no fallback beyond "…".
- Fix: `title={name}` on native doc and folder rows. Consider `ml-3` for nested groups inside the nav.

## Remaining P1 count: 2 (baseline carry-over 1 + new 1)
Carry-over: P1-3 (selected fill 1.06:1, fainter than hover). New: N-P1-1 (tree keys leak into the Inbox/Tasks row handlers).
P2 remaining: 5 open (carry-over P2-4, P2-7 + new N-P2-1, N-P2-2, N-P2-3) + 1 deferred (P2-5 undo, Rust). P3 remaining: 6 (P3-1, P3-2, P3-3, P3-5 + N-P3-1, N-P3-2).
