# Task cleanup proposal — reconcile Nimble with Todoist (2026-09-23)

Status: **approved 2026-09-23** (plan: `docs/superpowers/plans/2026-09-23-todoist-reconcile.md`). Fits inside C5 of `todoist-replacement-decisions.md`: it pulls C5's "sections/nesting land in first-class fields" work forward.

## What's actually wrong (measured 2026-09-23, read-only)

| Symptom | Root cause | Evidence |
|---|---|---|
| Nimble out of sync | Todoist sync has failed on every tick since **2026-08-31 17:11** with `401 Invalid token`. Nothing surfaced it. | `integration_sync_state.last_error`; token lives in `settings.todoist_api_token` |
| Stale and missing tasks | 3 weeks of Todoist use with no pull | Live Todoist: 935 active. Nimble open + linked: 945. Overlap only **552**. **393** open in Nimble but gone from Todoist (some may be a Canary shared project that the filter skipped, `6hCc2V4vVPvPcVfW`, so check it). **382** in Todoist but missing from Nimble. 1 open in Todoist but completed in Nimble. |
| Can't tell native from Todoist | By design, a new Nimble task goes to the outbox and becomes Todoist-linked once pushed. No immutable "created in" field, no UI mark. | Only **17** tasks were ever born in Nimble (3 open). The 297 unlinked-at-insert tasks are the 2026-04-17 bulk import. **7 outbox ops** have been stuck since the token died: 4 are tests, 2 are real (Queen Out figma adjustments, Annotate changes) and 1 is the "Queued Tasks - TEST" project. |
| Messy project list | The pull turns each Todoist **section into a fake project** named `Parent / Section` (`sync_loop.rs:576-598`). It never sets `projects.parent_id`, never renames sections and never archives projects that were removed in Todoist. | Nimble has 62 linked project rows: about 33 are sections, and many are dead in Todoist (Work, todo lol, Priority Tasks, NEED TO FINISH TONIGHT…). Todoist actually has 19 projects and 32 sections, with 12 projects nested under 🏡 Personal. Two inboxes: the native `inbox` and a separate linked Todoist Inbox row. |

## Options

- **A. Just paste a new token.** Cheapest, but the fake-section projects and dead projects stay. An incremental catch-up after three weeks is also a risk to trust. ✗
- **B. Reconcile, then mirror (recommended).** Fix the mapper, turn the fake projects back into real sections and nesting, then run a full re-sync from Todoist with a dry-run report first. After that, Nimble mirrors Todoist until cutover.
- **C. Cut over now.** Import once, disconnect Todoist and make Nimble the truth today. Its gates are still open: the EDD recurrence exit test has never run, the phone reminder test is deferred, `dt` routing is unverified and C4 hasn't started. Portola is this weekend. ✗ for now.

## Plan B

### Phase 1: stop the rot (~1h)
1. New Todoist API token (Marco: Todoist → Settings → Integrations → Developer).
2. Make sync health visible: a status chip plus a banner when the last success is more than 1h old or `last_error` is set. The silent 401 is the real cause of problems 1 and 2.
3. Outbox cleanup: drop the 4 test ops and the TEST project, keep the 2 real tasks.

### Phase 2: reconcile (~4–6h, dry run, then approve, snapshot, apply)
Schema v22 + origin label:
- **Origin = a filterable `nimble` label** (Marco, 2026-09-23; replaces the proposed `origin` column). It's auto-applied to tasks created in Nimble while Todoist sync is on, and it syncs to Todoist too. The auto-apply stops at cutover, and then the label gets deleted. Todoist-born tasks stay unlabelled ("From Todoist" = open tasks without it). Backfill covers never-pushed native tasks only.
- Fake section projects become `sections` rows under their real parent. Their tasks move to the parent with `section_id` set.
- `projects.parent_id` is set from Todoist, and projects Todoist has archived or deleted get `archived_at`.
- The two inboxes become one.
- The mapper is fixed so future pulls write sections, nesting, renames and archiving correctly.
- **Reconcile in place, don't wipe.** Deleting a project cascades to its tasks (`ON DELETE CASCADE`), and focus queue, linked docs and calendar links all point at local task ids.

Then a full re-sync (sync token reset to `*`) runs as a **dry run first**. It prints X to add, Y to close, Z to move and projects to archive. Marco approves, then it takes a snapshot and applies. Stale tasks are marked completed with a "closed by reconcile" note, and the snapshot makes that reversible.

### Phase 3: Todoist-shaped sidebar (~3–4h)
- The nav shows projects only. Child projects nest under their parent and collapse. Archived projects are hidden.
- Sections show as headings inside the project page (`SectionedTaskList.tsx`), not in the nav.
- Label filter on task lists (include/hide per label) with "Made in Nimble" / "From Todoist" shortcuts.
- Optional Todoist hygiene pass first (garbage in, garbage out): "⭐️ TODAY - September 9", "‼️ Complete Today (Sep 22)", "Backlog".

### Phase 4: the path off Todoist (existing C-plan)
- While mirroring, new Nimble tasks still push to Todoist, so there's one list and no split brain. The `nimble` label keeps the "made in Nimble" fact after the push.
- The fixed mapper is the C5 import upgrade, so cutover becomes: stop sync, downgrade Todoist to free (D13).
- Remaining gates: C2 phone, C3 routing, C4, the EDD recurrence exit test. Todoist has 6 recurring tasks, and recurrence doesn't round-trip (`sync_loop.rs:730-741`).

## Decisions for Marco
1. Approve plan B.
2. Stale tasks: close them (recommended), or move them to an "Archive — reconcile" bucket?
3. During the transition, do new Nimble tasks push to Todoist? Recommended: yes, until cutover.

Scratch data (ID sets A/B/C/D, live snapshot): session scratchpad `todoist_live.jsonl`. Regenerate at dry-run time.
