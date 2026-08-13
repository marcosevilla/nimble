/** Always-present window-drag surface, independent of scroll position.
 * The Tasks page's containers (ProjectDetailPage, TasksPage's All Tasks
 * view) no longer use the old sticky `PageHeader` — Task 5's list header
 * scrolls with the content column — so this is the only drag surface left
 * on those pages for a frameless/transparent window (`decorations: false`,
 * `transparent: true` in tauri.conf.json). Must be rendered as a sibling
 * OUTSIDE the scrollable region, not inside it, or it scrolls away with
 * everything else. `h-6` matches the vertical space it replaces in the
 * page's top padding, so removing it doesn't change layout. */
export function PageDragRegion() {
  return <div className="h-6 shrink-0" data-tauri-drag-region />
}
