# Subagent-Driven Audit & Fix Loop — Playbook

A repeatable workflow for autonomously auditing Nimble, finding bugs and UX/visual issues, and executing fixes with multi-agent verification. Designed to be benchmarked against the app's intended UX, not vibes.

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
From `nimble/CLAUDE.md`: "No unit or integration tests." So "triple-check" can't lean on a green test bar. Substitute:

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
Canonical rubric lives at **`nimble/docs/ux-intent.md`**. Consolidated from `CLAUDE.md`, `docs/linear-ux-patterns.md`, `nimble/docs/buildplan.md`, and the `project_app_vision.md` memory.

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
- [x] Start Vite dev server: `cd nimble/apps/desktop && npm run dev` (Vite reports `http://localhost:5173/`, not 1420)
- [x] Smoke check: navigate Playwright to Vite URL and screenshot. **Onboarding bypass:** in browser (no Tauri runtime) `invoke()` throws, so `setupComplete` falls back to `false` and SetupDialog blocks the app. DEV-only `window.__stores.useAppStore` hatch added in `apps/desktop/src/main.tsx`. From Playwright: `window.__stores.useAppStore.getState().setSetupComplete(true)` to render Today. Known non-fatal: `Dashboard.tsx:122` Tauri `listen()` throws `transformCallback` undefined — flag for the audit, doesn't block render.
- [x] Dispatch 3 audit agents on the Today page (design-qa, interface-craft, make-interfaces-feel-better)
  - Each cites `ux-intent.md` section numbers in findings
  - Each writes findings to its own markdown file in `nimble/docs/audit-findings/today/`
  - Totals: design-qa 12 (3 blocker / 4 major / 4 minor / 1 polish), interface-craft 10 (1 / 3 / 3 / 3, craft 2/5), make-interfaces-feel-better 10 (0 / 0 / 6 / 4). 32 findings total.
- [x] Synthesize findings → plan via `superpowers:writing-plans` — saved to `nimble/docs/superpowers/plans/2026-05-10-today-page-audit-fixes.md`. 7 lanes (A no-guilt language, B calendar error chrome, C color tokens, E button base, G misc safety — all independent; D composition, F polish — both blocked on Gate 0). 17 tasks total before Gate 0; 9 after.
- [x] Marco reviewed plan + answered Gate 0: 1=a 2=a 3=a 4=b
- [x] Execute fixes in worktrees (subagent-driven). Pre-Gate-0 worktree `audit-loop-1-today` (12 commits, merged 2026-05-11 as `cec3786`). Post-Gate-0 worktree `audit-loop-1-today-composition` (10 commits, merged 2026-05-11 as `c8fdf5d`).
- [x] Verify — TS build clean, Playwright golden flow (Enter advances Step 1→2 confirmed). Rust check fails on stale path cache (pre-existing, unrelated).
- [x] Post-run notes (below) — filled in.

## Post-run notes

_(fill in after each loop)_

### Dry run #1 — Today page (2026-05-09 → 2026-05-11)

**Outcome:** loop completed end-to-end. 32 audit findings → 22 implementation tasks (12 pre-Gate-0, 10 post-Gate-0) → all merged to main on 2026-05-11. Empty-state Today now matches the §2.1 "guided morning" intent: centered 520px column, ghost upcoming steps, Coffee-icon empty calendar copy, Enter advances steps, muted calendar offline message.

**What worked:**
- **Three parallel audit lanes** caught distinct issues with minimal overlap. design-qa nailed the no-guilt language (blocker). interface-craft saw the composition failure at 2/5 craft — a signal a token-level linter would never produce. make-interfaces-feel-better caught the polish wins (font smoothing, scale-on-press, stagger). Three angles is the right number.
- **Gate 0 design pattern.** Forcing composition decisions before polish tasks executed prevented re-doing F-lane work after D shifted layout. Worth keeping for future surfaces.
- **Cheapest-model subagents for mechanical tasks.** Haiku handled 18 of 22 tasks cleanly. Sonnet was the right call for C1 (token wiring, multi-file judgment) and F5 (handler logic + multiple JSX edits).
- **Worktree isolation** kept the two lanes from clobbering each other. Two worktrees (pre-Gate-0 and post-Gate-0) handled the dependency cleanly.
- **DEV-only `window.__stores` bypass** unblocked Playwright without a full MockDataProvider build. Cheap escape hatch, paid for itself in dry run #1.

**What leaked:**
- **Implementers don't reliably cd to the worktree.** Lane D1's implementer committed to main instead of `audit-loop-1-today-composition`. Fixed by cherry-picking + reset. Mitigation for next loop: every implementer prompt now leads with "YOUR FIRST TOOL CALL MUST BE `cd <worktree> && pwd && git branch --show-current`" + a paste-back verification requirement. Worked perfectly for D2 onwards.
- **Code-quality reviewers don't read the plan, only the diff.** Lane A1's reviewer flagged TriageSection's `overdue` as Critical — but that was explicitly A2's scope. Mitigation: pass the FULL plan section (with sibling task boundaries) to the reviewer, not just the task under review.
- **Audit agents over-cite from pixels.** Interface-craft's "right-rail collapse icon" finding had no corresponding component code — implementer + reviewer both searched calendar/ and Dashboard.tsx, found nothing. The icon visible in the screenshot is likely an Agentation/TypeOverlay element. Mitigation: instruct audit agents to verify each finding has a code anchor before reporting it.
- **Per-task Playwright would have meant restarting Vite in each worktree.** We batched smoke checks at the merge checkpoints instead. Worked, but means polish lanes were verified together rather than incrementally. Acceptable tradeoff for the dry run.
- **No populated-state verification.** All audits ran against the empty state because the DEV bypass only flips `setupComplete=true` — actual data loads still throw because `invoke()` fails outside Tauri. We never visually confirmed lanes A1/A2 (Overdue rename, TriageSection copy), C1/C2 (ProgressBar, badge tokens with real green completion state), or G3 (+N more alignment with calendar events). Substituted via source inspection. Real fix for loop #2: MockDataProvider.
- **Rust target cache is stuck on the OLD project path** (`personal triage and briefing app/` with spaces). `cargo check` fails to resolve permission TOML files. Unrelated to the audit but blocks the playbook's "Rust clean" verification. Fix: `rm -rf nimble/target/` and rebuild — pre-existing tech debt.

**Adjustments for next loop:**
1. **Subagent prompt header template:** always start implementer prompts with the cd verification block (proven in lanes D2-F5).
2. **Reviewer prompt header template:** include the relevant plan section AND its sibling task boundaries, so reviewers don't flag in-scope-of-other-task items as Critical.
3. **Audit-agent constraint:** "Every finding must cite a file:line or a specific component name. Findings sourced from screenshot inspection alone require a code anchor — search the surface before reporting."
4. **MockDataProvider for the next loop.** Highest-leverage missing piece. Without it, the audit can only see the empty/error state of each surface.
5. **Skip formal 3rd-agent code-quality review for sub-3-line trivial CSS/className changes** — self-verification via `git show` is faster and equally rigorous when the change has zero behavioral surface (G1, G2 worked fine without).
6. **The 2-tier opacity scale** from Lane C3 didn't fully land — we collapsed `/5+/20+/30` to just `/30`. Worth deciding if `/30` everywhere is right or if there really is a "subtle vs chrome" distinction worth a second tier. Re-audit after loop #2's data.

**Source files left modified that should NOT ship in this branch state:**
- `apps/desktop/src/main.tsx` — `window.__stores` DEV-only export. Keep as long as audit loops are active. Re-evaluate when MockDataProvider lands and the bypass is no longer needed.

**Final commit on main:** `c8fdf5d merge: audit-loop-1-today-composition — Gate-0 fixes (lanes D + F)` (14 commits ahead of origin/main).
