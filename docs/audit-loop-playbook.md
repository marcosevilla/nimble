# Subagent-Driven Audit & Fix Loop — Playbook

A repeatable workflow for autonomously auditing Daily Triage, finding bugs and UX/visual issues, and executing fixes with multi-agent verification. Designed to be benchmarked against the app's intended UX, not vibes.

First written 2026-05-09 alongside the first dry run on the Today page. Update this doc after each loop with what worked and what didn't.

---

## The loop

### 1. Audit (parallel, read-only)

Multiple agents run concurrently, each owning a surface area, each writing findings to its own markdown file.

- **`design-qa`** — sweeps for design system violations (sizing, tokens, typography, a11y). Workhorse.
- **`interface-craft`** (Design Critique mode) — Josh Puckett's systematic UI review. Catches "this feels off" issues that design-qa misses.
- **`make-interfaces-feel-better`** — principle reference the audit agents should cite when flagging polish items (stagger, optical alignment, tabular nums, etc.).
- **`superpowers:dispatching-parallel-agents`** — coordinates the parallel audit. One agent per surface area (Today, Tasks, Goals, Focus, Activity Log, Mobile).

### 2. Synthesize + plan

- **`superpowers:writing-plans`** — turns the audit dump into a prioritized, gated implementation plan. The plan keeps the fix phase from drifting.
- **`superpowers:brainstorming`** — only if findings are ambiguous (e.g. "redesign or fix?"). Skip for clear bugs/polish.

### 3. Execute (parallel, isolated)

- **`superpowers:using-git-worktrees`** — non-negotiable. Two concurrent sessions on the same repo will stash each other's work (see lesson 2026-05-02). One worktree per agent.
- **`superpowers:subagent-driven-development`** — the dispatch pattern for executing the plan with independent tasks.
- **`superpowers:systematic-debugging`** — agents auto-load this when they hit a real bug rather than a polish item.

### 4. Verify (the "double and triple check")

- **`superpowers:verification-before-completion`** — every agent must run verification commands and quote the output before claiming done. Most important guard against false success claims.
- **`superpowers:requesting-code-review`** — a fresh agent reviews each finished branch against the original audit finding *and* the intended UX rubric.
- **`review`** — final pre-ship pass before merging worktrees back to main.

### 5. Discovery / safety net

- **`find-skills`** — if mid-audit we hit something none of the above cover (e.g. accessibility deep audit, animation timing audit), pull a new skill instead of improvising.

---

## Two known gaps to design around

### No test suite
From `daily-triage/CLAUDE.md`: "No unit or integration tests." So "triple-check" can't lean on a green test bar. Substitute:

- TypeScript clean (`npm run build` in `apps/desktop`)
- Rust clean (`cargo check` from workspace root)
- Playwright MCP smoke pass on golden flows (resolved 2026-05-10 — install below)
- Visual diff on screenshots (before/after)

**Playwright MCP install (Marco runs this — Claude can't add MCPs from inside a session):**

```sh
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest
```

(Use `-s user` to make it available across projects, or drop the flag for project-scoped install. After install, restart the Claude Code session so the new MCP tools register.)

Golden flows that the Playwright smoke pass must cover (initial list — expand as we run loops):
- First-open-of-the-day → guided review flow → dashboard mode transition
- Quick capture: inbox input, Cmd+K, tray menu — all three entry points
- Task lifecycle: create → edit inline → focus → complete → activity log entry
- Prefix routing: `/idea`, `/quote`, `/task`, no prefix
- AI priorities: generate, cache, re-open same day shows cached
- Empty states: cleared inbox, no tasks today, no calendar events

### UX rubric — resolved 2026-05-10
Canonical rubric lives at **`daily-triage/docs/ux-intent.md`**. Consolidated from `CLAUDE.md`, `docs/linear-ux-patterns.md`, `daily-triage/docs/buildplan.md`, and the `project_app_vision.md` memory.

Audit agents are instructed to:
1. Read Section 1 (core philosophy) in full.
2. Read Section 2 entry for their assigned surface.
3. Skim Section 3 (anti-patterns).
4. Cite section numbers in every finding. No citation = preference, not finding.

Update `ux-intent.md` first when intent changes, then sync source docs to match.

---

## Dry run plan: Today page (desktop)

End-to-end on one surface before scaling:

1. 3 audit agents → 1 plan → 2 fix agents in worktrees → verification → review.
2. Capture what worked and what leaked.
3. If ergonomics hold, scale to the rest of the app. If not, fix the loop here before spending a long session on it.

---

## Current run state

**Dry run #1 — Today page (started 2026-05-10).** Resume from whichever step is unchecked.

- [x] Playbook written (`audit-loop-playbook.md`)
- [x] UX rubric consolidated (`ux-intent.md`)
- [x] Playwright MCP installed by Marco — `claude mcp add playwright -s user -- npx -y @playwright/mcp@latest`, then `/exit` and relaunch
- [x] Verify Playwright tools load in new session (ask: "list playwright mcp tools")
- [x] Start Vite dev server: `cd daily-triage/apps/desktop && npm run dev` (Vite reports `http://localhost:5173/`, not 1420)
- [x] Smoke check: navigate Playwright to Vite URL and screenshot. **Onboarding bypass:** in browser (no Tauri runtime) `invoke()` throws, so `setupComplete` falls back to `false` and SetupDialog blocks the app. DEV-only `window.__stores.useAppStore` hatch added in `apps/desktop/src/main.tsx`. From Playwright: `window.__stores.useAppStore.getState().setSetupComplete(true)` to render Today. Known non-fatal: `Dashboard.tsx:122` Tauri `listen()` throws `transformCallback` undefined — flag for the audit, doesn't block render.
- [x] Dispatch 3 audit agents on the Today page (design-qa, interface-craft, make-interfaces-feel-better)
  - Each cites `ux-intent.md` section numbers in findings
  - Each writes findings to its own markdown file in `daily-triage/docs/audit-findings/today/`
  - Totals: design-qa 12 (3 blocker / 4 major / 4 minor / 1 polish), interface-craft 10 (1 / 3 / 3 / 3, craft 2/5), make-interfaces-feel-better 10 (0 / 0 / 6 / 4). 32 findings total.
- [x] Synthesize findings → plan via `superpowers:writing-plans` — saved to `daily-triage/docs/superpowers/plans/2026-05-10-today-page-audit-fixes.md`. 7 lanes (A no-guilt language, B calendar error chrome, C color tokens, E button base, G misc safety — all independent; D composition, F polish — both blocked on Gate 0). 17 tasks total before Gate 0; 9 after.
- [ ] Marco reviews plan, gates execution
- [ ] Execute fixes in worktrees (2 agents max for dry run)
- [ ] Verify (`superpowers:verification-before-completion`) + fresh-agent review + final `review` pass
- [ ] Post-run notes (below) — fill in what worked, what leaked, adjustments

## Post-run notes

_(fill in after each loop)_

### Dry run #1 — Today page (date: TBD)

- What worked:
- What leaked:
- Adjustments for next loop:
