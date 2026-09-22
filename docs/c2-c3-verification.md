# C2/C3 implementation verification

Status: implementation and final code review complete; production activation is not complete.

## Isolation

Feature branch `codex/c2-c3-reminders-agents`, based on `254bcf1`. Development uses a standalone `Nimble Development Test.app` with identifier `com.marcosevilla.nimble-c23-test`. It points at a marked private temporary profile, not production. Google and existing remote sync are disabled for this synthetic profile. `/Applications/Nimble.app` and production tasks are unchanged.

## Observed native checks — 2026-09-21

- The standalone bundle builds, signs ad hoc, launches, and initializes schema20.
- Settings displays Mac reminders, persisted `America/Los_Angeles` timezone and Google connection controls. Google shows disconnected; live network remains disabled in this build.
- CLI creates a timed reminder task in the marked profile and receives `refresh: acknowledged`.
- With that task's detail open, CLI changes its title; the open heading changes without navigation. CLI acknowledgement took 0.013 seconds. This confirms visible refresh; no instrumented claim about exact paint latency.
- At the configured reminder time, the native notification plugin succeeds and the delivery ledger records `notified` with `last_fired_at`. OS banner visibility has not yet been independently observed.
- Completing a separate test task before delivery supersedes its pending reminder.
- `dt backup now` and `dt backup verify` succeed through the real running app's socket; recovery remains isolated and no online publication is configured.

## Automated checks so far

- Full Rust workspace suite passes: **320 tests, 0 failures**, run outside the sandbox for real local HTTP/Unix sockets and macOS file events. Log `/private/tmp/nimble-c23-final-rust.log`.
- Desktop and web production frontend builds pass.
- New UI event/intent tests: five passed. Targeted lint on new UI and shared event integration passes.
- C3: ten executable CLI tests, three core protocol tests, three desktop IPC/sync tests pass; includes real local Unix sockets and synthetic Todoist outbox assertions.
- Foundation: 29 focused schema/export/snapshot/recovery tests pass after review fixes, including frozen pre-change C1 archive bytes through both recovery routes.
- C2: pure scheduling and fake-provider reconciliation tests pass. Actual localhost HTTP transport regressions pass, including exact paths/headers, Retry-After, ETag and failed-page sync-token preservation.

## Review status

Foundation review identified cancellation-unsafe transactions and a concurrent reminder validation race. Both were fixed in `1dafec0`, with managed immediate transactions and immutable C1 archive fixtures; scoped re-review confirmed all three fixes. A project-move regression found in that fix was corrected in `fde821f` and passed scoped re-review.

Combined review identified Calendar URL assembly, expired-token reconnect, calendar reuse, unfired A→B→A reminder restoration, stale ETag deletion and remote timezone conversion. The coordinated fix wave `b36f574` addresses all six findings and passes scoped re-review, with no additional blocking regression found.

## Remaining acceptance

- [x] Final complete Rust suite outside the macOS filesystem-event sandbox: 320 passed.
- [x] Scoped re-review of fixes; frontend desktop/web builds pass. Final native bundle build is recorded below.
- [x] Reopen test app after a missed reminder and confirm persistent catch-up UI; dismissal removed the item.
- [ ] Independently observe native OS banner presentation.
- [ ] Configure Google Desktop OAuth client, consent mode and real account connection.
- [ ] Physical phone alarm and two-way event-edit acceptance.
- [ ] Installed CLI / agent workflow routing activation and live web propagation acceptance.
- [ ] Production app update and code integration, following review.

Mocked transport success does not establish phone delivery. Mac reminders need Nimble running; missed occurrences appear on reopen. Already-published Google events can alert while the Mac app is closed, but new changes/current recurrence advancement need Nimble to sync.
