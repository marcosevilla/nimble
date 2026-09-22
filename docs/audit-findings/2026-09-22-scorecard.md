# Design facelift scorecard — 2026-09-22

Scores are 1–5 per dimension (UI / Interaction / UX / Accessibility), from `docs/audit-findings/<surface>/2026-09-22-loop<N>.md`. "After" columns are filled by the re-score step of each loop.

## Loop 1 — baseline (before any fix)

| Surface | UI | Int | UX | A11y | Avg | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|
| Today | 3 | 2 | 2 | 3 | 2.50 | 9 | 10 | 5 |
| Tasks + detail | 3 | 2 | 3 | 2 | 2.50 | 6 | 8 | 6 |
| Inbox | 3 | 2 | 2 | 2 | 2.25 | 5 | 12 | 4 |
| Goals | 3 | 2 | 3 | 2 | 2.50 | 6 | 11 | 6 |
| Session | 2 | 2 | 3 | 2 | 2.25 | 5 | 8 | 6 |
| Docs | 3 | 2 | 3 | 2 | 2.50 | 3 | 10 | 7 |
| Settings + setup | 2 | 2 | 2 | 3 | 2.25 | 4 | 16 | 3 |
| Shell | 3 | 2 | 3 | 2 | 2.50 | 7 | 12 | 5 |
| **Grid** | 2.75 | 2.00 | 2.63 | 2.25 | **2.41** | **45** | **87** | **42** |

Root causes shared by every surface (see `2026-09-22-loop1-plan.md`):
1. Focus ring imperceptible (`--ring/50`, measured 1.44:1 light) and zero `prefers-reduced-motion`.
2. Hardcoded palette colors (73 sites) where `--success` and friends exist or should.
3. Mouse-only rows and hover-only actions on Tasks, Inbox, Docs, Goals; advertised shortcuts (`j/k`, `?`, `g`-prefix, ⌥M) not wired.
4. Urgency-performing copy and color (red past-due dates, "needs attention", "Overdue Check-in", Title Case).
5. Seven page frames, four card recipes, three ring recipes, ≈45 literal durations.

## Loop 1 — after (to be filled by the re-score step)

| Surface | UI | Int | UX | A11y | Avg | Δ | P1 left |
|---|---|---|---|---|---|---|---|
| Today | | | | | | | |
| Tasks + detail | | | | | | | |
| Inbox | | | | | | | |
| Goals | | | | | | | |
| Session | | | | | | | |
| Docs | | | | | | | |
| Settings + setup | | | | | | | |
| Shell | | | | | | | |
