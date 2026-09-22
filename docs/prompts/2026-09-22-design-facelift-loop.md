# Nimble design facelift — orchestrated audit/plan/execute loops

Paste everything below the line into a fresh Claude Code session opened at `~/Developer/marco-task-app/nimble`, running Fable 5.1.

---

You are the orchestrator for a holistic design facelift of Nimble, the Tauri + React desktop app in this repo. Your job is to run up to **4 loops** of audit → plan → execute → verify, dispatching subagents for every audit, fix, and review. You do not audit or fix code yourself. You read reports, decide, dispatch, and gate.

## 0. Ground yourself first (read, do not skim)

1. `CLAUDE.md`, `NEXT.md` (current status, locked decisions).
2. `docs/ux-intent.md` — the canonical rubric. Every finding must cite a section of this doc, never vibes.
3. `docs/audit-loop-playbook.md` — the loop you are running. Follow it; improve it at the end.
4. `docs/polish-pass-audit.md`, `docs/typography-system.md`, `docs/theming-research.md`, `docs/audit-findings/` — prior findings. Do not re-report what is already fixed; do re-report what is still open.
5. `apps/desktop/src/index.css` and `themes.css` — the token layer. Light and dark both ship.
6. `apps/desktop/package.json` scripts — find the web dev server and build commands. Screenshots come from the web client via the Playwright MCP unless it cannot render a surface, in which case use `npm run tauri dev`.

Restate in five lines what the app is, who it is for (one ADHD user, morning triage, keyboard-first, Linear-inspired, no-guilt), and what "done" looks like. Then start Loop 1.

## 1. Surfaces and dimensions (the audit grid)

**Surfaces** (one audit agent each, parallel, read-only):
- Today (`components/pages/TodayPage.tsx`, `components/today/`) — guided morning + dashboard
- Tasks (`TasksPage.tsx`, `components/tasks/`, task detail `components/detail/`)
- Inbox + capture (`InboxPage.tsx`)
- Goals (`GoalsPage.tsx`, `components/goals/`)
- Session / focus (`SessionPage.tsx`, `components/focus/`)
- Docs (`DocsPage.tsx`, `components/docs/`, `components/obsidian/`)
- Settings + setup (`SettingsPage.tsx`, `components/settings/`, `components/setup/`)
- Shell: `components/layout/` (NavSidebar, RightSidebar, Dashboard), command bar, `components/shared/`, `components/ui/`

**Dimensions** every surface agent scores 1–5, with evidence:
- **UI / visual:** tokens vs hardcoded values, type scale, color and contrast (both themes), spacing rhythm, radius, borders/shadows, icon weight and size, optical alignment, tabular numbers, density.
- **Interaction:** keyboard coverage and focus rings, hover/active/pressed states, hit areas, transitions and motion restraint, optimistic updates, loading/empty/error states, undo where destructive.
- **UX:** does the surface serve the morning triage flow, capture flow, and task-detail editing flow with minimal decisions; no-guilt language; discoverability of the editor and shortcuts; consistency with the other surfaces; information hierarchy.
- **Accessibility:** roles, labels, contrast, reduced-motion, focus order.

Each audit agent writes `docs/audit-findings/<surface>/2026-09-22-loop<N>.md` with: scorecard, then findings as `P1 / P2 / P3`, each with file:line, screenshot path (light and dark), the rubric section violated, and a one-line proposed fix. Cap 25 findings per agent; prefer fewer, sharper ones.

**Skills the audit agents must load** (tell them explicitly): `design-qa` in audit-only mode (no Linear tickets, no Slack), `interface-craft` in Design Critique mode, `make-interfaces-feel-better` (full review mode), `better-ui`, `better-typography`, `better-colors`. One extra cross-cutting agent runs `frontend-design` and answers a single question: what would make Nimble feel like one designed object rather than seven pages, and what is the smallest set of changes that gets there.

## 2. Loop structure (repeat up to 4 times)

**Loop N.1 Audit.** Dispatch the 8 surface agents plus the cross-cutting agent in parallel (`superpowers:dispatching-parallel-agents`). Use Sonnet or the `researcher` agent for grep-style sweeps; use your own model for the critique agents. Wait for all reports. Do not start planning on partial results.

**Loop N.2 Synthesize and plan.** Merge findings into `docs/audit-findings/2026-09-22-loop<N>-plan.md` using `superpowers:writing-plans`. Group by theme, not by page (for example "focus ring system", "empty states", "task row density", "type scale drift"). Order by: P1 rubric violations → cross-surface consistency → per-surface polish. Each task in the plan names the files, the acceptance check, and the screenshot to retake. Mark anything **structural** (new page, nav or IA change, redesigning task-detail inline editors, which Marco is mocking in Figma) as `QUEUED FOR MARCO`, not executable.

**Gate:** after Loop 1's plan only, stop and show Marco the plan summary, the scorecards, and the top 10 fixes. Wait for approval. Loops 2–4 run without a gate unless a plan item is structural or touches Rust.

**Loop N.3 Execute.** `superpowers:subagent-driven-development` with `superpowers:using-git-worktrees`. One worktree per theme, one implementer agent per worktree, never two agents in the same tree. Implementers load `make-interfaces-feel-better` and `superpowers:test-driven-development` (tests where a behavior changes; visual changes get a retaken screenshot instead). They commit per theme with a message that names the rubric section and ends with the Co-Authored-By line from the session reminder.

**Loop N.4 Verify.** For every finished theme: a fresh reviewer agent runs `superpowers:requesting-code-review` against the original findings and `docs/ux-intent.md`, retakes the light and dark screenshots, and runs `npm run build`, `npm run build:web`, the frontend tests in `apps/desktop/tests`, and `cargo test --workspace --offline` if any Rust file moved. Quote the command output. `superpowers:verification-before-completion` is mandatory; no agent may say "done" without pasted output. Merge only reviewer-approved themes into `main`.

**Loop N.5 Re-score.** Re-run only the surface agents whose surfaces changed. Record before/after scores in `docs/audit-findings/2026-09-22-scorecard.md`.

**Stop conditions:** stop early when a loop produces zero P1 and fewer than 5 P2 findings, or when the average score improves by less than 0.2 across the grid. Always stop after Loop 4.

## 3. Hard guardrails

- Frontend only: `apps/desktop/src`. No schema, sync, migration, `nimble-core`, or Tauri command changes unless a UX fix is impossible without one, and then queue it for Marco instead.
- Do not re-litigate locked decisions: Cmd+K is actions-only; vault editing stays disabled; C1–C5 order stands; no streaks, overdue shaming, or "you've been away" copy anywhere.
- Preserve every existing keyboard shortcut. Additions are fine, removals are not.
- No new npm dependencies without listing them in the plan and getting the gate approval.
- Never install to `/Applications`, never deploy to Vercel, never touch Todoist or Google. The mobile app is dormant, ignore `apps/mobile`.
- Tokens over literals: any new color, size, or radius goes into `index.css`/`themes.css` and is referenced, not inlined. Both themes must pass contrast.
- Reduced motion is respected on every animation you add or change.
- Do not reproduce any credential or run broad process diagnostics (see NEXT.md 2026-09-21 note).
- After two failed attempts on the same fix, the implementer stops and reports instead of retrying.

## 4. Reporting (ADHD mode, every time you surface to Marco)

- First line is the next action Marco can take.
- Then a 5-row max table: surface, score before, score after, P1s left.
- Then at most 5 bullets of what changed, each with one file path.
- Screenshots referenced by path, light and dark side by side where possible.
- One closing action. No recaps.

## 5. Wrap (after the final loop)

1. Update `docs/audit-loop-playbook.md` with what worked and what did not in this run.
2. Update `NEXT.md`: add a "Design facelift — 2026-09-22" block with merged themes, queued structural items, and open P2/P3s. Newest first.
3. Leave `main` clean and building. List the worktrees left behind so Marco can prune them.
4. Final message: the scorecard delta, the three biggest visible changes, and the single next design decision Marco needs to make in Figma.

Begin with section 0 now.
