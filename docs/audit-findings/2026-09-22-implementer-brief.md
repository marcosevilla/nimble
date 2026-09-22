# Stage B implementer brief (shared) — 2026-09-22

You are one of six implementers running in parallel, each in its own git worktree. Your dispatch names your worktree, branch, theme, dev-server port and the tasks you own. This file holds the rules every implementer follows.

## Worktree discipline

- **Your first tool call is** `cd <your worktree> && pwd && git branch --show-current`. If the branch is not yours, STOP and report.
- Run every command from inside your worktree. Never `cd` into `/Users/marcosevilla/Developer/marco-task-app/nimble` (that is `main`) or into another `.worktrees/*` directory. Reading files there is fine; writing is not.
- Never use bare `git stash`. Commit WIP instead.
- You do not dispatch subagents. A reviewer is dispatched separately after your report.

## Spec

`docs/audit-findings/2026-09-22-loop1-plan.md` (in your worktree) — read "Global constraints", "Screenshot recipe", and your Stage B section. Then read every finding your section cites in `docs/audit-findings/<surface>/2026-09-22-loop1.md`: each carries the `file:line` anchor, the rubric section, measured values and a one-line fix. The finding is the code-level spec; the plan section is the scope fence. Also read `docs/ux-intent.md` §1 and §3.

Stage A already merged into your base. It gives you: `--ring` at measured contrast + a global `:focus-visible` 2px rule + a `.focus-ring` utility; `--muted-foreground-subtle`; a `@media (prefers-reduced-motion: reduce)` block; `--warning`, `--ai`, `--status-todo|in-progress|blocked|complete`, `--shadow-popover`, warm `--sidebar*`; `lib/shortcuts.ts` (`SHORTCUTS` registry the help panel renders; append your section at the end, never reorder); `docs/typography-system.md` matching the live 8-token scale (label, meta, meta-strong, body, body-strong, title, display, timer). Use these; do not redefine them.

## Skills to load before editing

`make-interfaces-feel-better` (full review mode), `superpowers:test-driven-development` (a node test where behaviour changes — registry shape, index math, parsers; visual-only changes get a retaken screenshot instead), `superpowers:verification-before-completion`.

## Hard rules

- Frontend only, `apps/desktop/src` (+ `apps/desktop/tests`, `docs`). No Rust, schema, sync, Tauri commands, `apps/mobile`. If a fix needs one, skip it and list it under "queued" in your report.
- Stay inside the files your section says you **own**. If you must touch a file another theme owns, make the smallest possible change and list it in the report under "cross-theme touches" so the merge order can handle it.
- Locked: Cmd+K actions-only; vault editing disabled; no streaks / "overdue" / "you've been away" copy; every existing keyboard shortcut is preserved (additions only; `q` stays quick-create).
- No new npm dependencies.
- Tokens over literals: no new hex, raw Tailwind palette classes, `text-[Npx]`, literal `duration-N`, `font-medium` stacks, `uppercase`, or positive tracking. Colors come from `themes.css` tokens; sizes from the 8-token scale; motion from `--transition-fast|base|slow` and `--ease-entrance|exit`.
- Sentence case for every string you write.
- Never print credential-like strings; no broad process diagnostics (`ps aux` etc.).
- After two failed attempts at one fix, stop that fix and report it.

## Verification (paste output, no claims without it)

From `apps/desktop` in your worktree, run and paste the last ~5 lines of each:

```
npm run build
npm run build:web
node --test tests/*.test.mjs
```

Screenshots: start your own dev server on your assigned port: `npm run dev -- --port <port>`. Use the Playwright MCP (ToolSearch `select:mcp__playwright__browser_run_code_unsafe,mcp__playwright__browser_console_messages`). **The Playwright browser is shared by several agents at once, and Marco watches it.** Open a new TAB in the existing window, never a new context or window (`browser.newContext()` opens a new Chrome window). Inject the mock per page with `page.addInitScript`, never `context.addInitScript` (that would stack mocks onto every agent's tabs). Close your tab when done:

```js
async (page) => {
  const p = await page.context().newPage();            // new tab, same window
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.addInitScript({ path: '<your worktree>/tools/mock-tauri.js' });  // this tab only
  await p.goto('http://localhost:<port>/?page=tasks');
  await p.waitForTimeout(800);
  await p.addStyleTag({ content: '[data-agentation-root]{display:none!important}' });
  // dark: await p.evaluate(() => document.documentElement.classList.add('dark'));
  await p.screenshot({ path: '<your worktree>/docs/audit-findings/screenshots/loop1-after/<surface>-<state>-light.png' });
  await p.close();                                      // always close your tab
  return 'ok';
}
```

Full recipe (deep-link `?page=`, `&review=open`, `openTask('task-01')`, Cmd+K) in `docs/audit-findings/screenshots/loop1-before/INDEX.md`. Save after-shots under `docs/audit-findings/screenshots/loop1-after/` named `<surface>-<state>-<light|dark>.png` — the same states as the before-shots your section names, so a reviewer can diff them side by side. Prove keyboard behaviour with Playwright keypresses and `document.activeElement` checks, not by reading code. Zero new console errors (the known non-fatal `listen()`/`transformCallback` warning is fine). Stop your dev server when done.

## Commits

One commit per task (or per tight cluster of same-shape fixes), message `fix(<theme>): <what> (§x.y)`, body naming the finding IDs, ending with the line:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

Commit screenshots with the task they verify.

## Report

Write the full report to `.superpowers/sdd/2026-09-22-loop1-plan/<theme>-report.md` in your worktree (create the dir; it is git-ignored): per task — what changed, finding IDs closed, evidence; verification output; screenshot paths; cross-theme touches; queued items with why. Return to the orchestrator ONLY: status (DONE / DONE_WITH_CONCERNS / BLOCKED), commit SHAs, one line of test/build results, and concerns.
