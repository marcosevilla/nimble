# Research: shadcn's Copper — Quick-Add & Shortcut Flow

*Researched 2026-08-01 from [the X post](https://x.com/shadcn/status/2082519375194763675) (Jul 29, 2026, ~417k views), [shadcn.com/copper](https://shadcn.com/copper), and a [follow-up post on sections](https://x.com/shadcn/status/2083180011918393519).*

## What Copper is

shadcn launched **Copper**, a $39 one-time-purchase macOS app (macOS 14+) for capturing "things you want to keep and prompts you want to try next while working with AI." His pitch: you're in ChatGPT/Claude/Cursor/Chrome, you think "I'll need this later," and you don't want to stop what you're doing. Copper combines "the useful parts of a to-do list, a clipboard, and a scratchpad." Local-only, no sync, no account — notes saved to a local file.

## Feature-set breakdown

1. **Double-tap Shift to capture** — the signature interaction. From *any* app, tap Shift twice: if text is selected, it's captured (via macOS Accessibility APIs); otherwise the panel summons for typing. No Cmd-modifier chord to remember.
2. **Always-adjacent panel** — a small floating panel that "sits next to where you work," not a full app window you switch to. Summon, capture, dismiss without losing focus context.
3. **Prompt queueing** — the killer workflow: while the AI is still generating, type your next 2–3 follow-up prompts into Copper, then feed them back one at a time and **check them off as you go**. Items are simultaneously todos and clipboard entries.
4. **⌘C to send back** — select a captured item, copy, paste into the AI app. The item is a first-class copyable object, not just a list row.
5. **Sections via `# Name`** — type `# ProjectX` to create a section; ⌘K (or menu) switches the *active* section. Everything captured afterward auto-files there until you switch. Zero-decision filing.
6. **Local & private** — flat local file, no account, no telemetry. (Image/file attachments were announced as shipping the following week.)

No code/libraries were open-sourced; it's a paid closed-source app.

## How it maps to our app

Strong overlap with our philosophy — this is basically our "low-friction, pull-based, local-first" thesis applied to capture:

- **Maps cleanly:** global-summon capture (we already have `tauri-plugin-global-shortcut` + ⌘⇧T window toggle), check-off-as-you-go (our `local_tasks` + `captures` tables), auto-filing to an active section (our `capture_routes` prefix routing is the same idea, keystroke-shaped differently), local-first SQLite, keyboard-first.
- **Doesn't map / skip:** double-tap-Shift selected-text capture from other apps requires macOS Accessibility permissions and per-app text extraction — high effort, high fragility, and not our core use case (we're a triage app, not an AI-workflow sidecar). Prompt-queueing-for-AI is Copper's niche, not ours; the generalized version is just "quick task/note capture," which we want anyway.

## What we already have (relevant infrastructure)

- `CommandBar.tsx` (⌘K, in-app): search + smart quick-add — action-verb detection creates tasks, `note:`/`idea:` prefixes create captures, `/task` `/capture` `/doc` modes.
- `QuickCreateDialog.tsx`: structured task creation dialog.
- Tray menu "Quick Capture..." → shows main window + emits `open-quick-capture` (handled in `Dashboard.tsx:108`).
- Rust: `tauri-plugin-global-shortcut` registered (⌘⇧T toggles main window), tray icon, `captures` + `capture_routes` tables.
- Single `main` window in `tauri.conf.json` — no dedicated capture window yet.

The gap: our quick-add only works when the app window is up. Copper's insight is that **capture must not require a context switch into the app.**

## Recommendation (one option)

**Build a dedicated frameless "capture strip" window summoned by a global shortcut (⌘⇧Space), reusing CommandBar's parsing.** Scope: **M** (~1–2 sessions).

1. **New Tauri window** `capture` in `tauri.conf.json`: small (~560×64, grows with content), frameless, transparent, always-on-top, skip-taskbar, hidden by default, centered upper-third. Renders only a stripped-down CommandBar input (new `capture.html` entry point or `?window=capture` route in the existing Vite app).
2. **Global shortcut** ⌘⇧Space registered alongside the existing ⌘⇧T in `lib.rs`: show + focus the capture window (don't touch the main window). Esc or blur hides it.
3. **Reuse the existing brain:** the strip uses `parseMode`/action-verb/prefix logic from `CommandBar.tsx` (extract to a shared module) and existing invoke commands to write tasks/captures directly to SQLite — no new backend logic. On submit: toast "Added ✓", clear input, hide window. `emitTasksChanged` on the main window via a Tauri event so open views refresh.
4. **Copper idea worth stealing outright:** the *active section* pattern — a `# project` token (or last-used project) persists as the default target in `settings`, so repeated captures file to the same place with zero decisions. Our `capture_routes` table already models routing; this adds a sticky default.
5. Rewire the tray "Quick Capture..." item to open the capture strip instead of the full window.

This is ADHD-gold: thought → two keys → type → Enter → back to work, sub-2-seconds, no window switch, no guilt, works even when the app is "closed" (we already autostart + live in the tray).

**Skip for now:** double-tap-Shift (Accessibility-API selected-text capture) and any AI-prompt-specific features. If double-Shift ergonomics prove tempting later, it can be added as an alternate binding, but modifier+Space is conflict-free and native to Tauri's shortcut plugin today.

## Open questions for Marco

1. **Shortcut choice:** ⌘⇧Space proposed — conflicts with anything you use? (⌥Space is Raycast-style; ⌘⇧C is free too.)
2. **Default destination:** should bare text go to Inbox `captures` (current CommandBar behavior) or create a `local_tasks` todo? Recommend keeping the action-verb heuristic.
3. **Sticky section:** want the Copper-style "active project" default, or always Inbox + prefix routing?
