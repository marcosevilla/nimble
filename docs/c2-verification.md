# C2 reminder verification

## Implemented boundaries

- A scheduled occurrence is derived from the task's wall date/time, configured IANA timezone, and reminder offset. DST ambiguity uses the earlier instant; nonexistent times surface an error. A title edit retains the occurrence key.
- A device-local SQLite ledger records pending, dispatching, notified, catch-up, acknowledged, and superseded occurrences. Interrupted dispatch resumes as a review item. Due tasks older than 90 seconds enter catch-up without a burst of native banners.
- Native notifications are requested only through the explicit Enable action. A denied or failed notification keeps a catch-up item. Debug builds require an isolated synthetic profile for the runner.
- Google tokens are excluded from SQLite and exports. The Calendar worker uses a dedicated calendar ID, deterministic event IDs, private task marker, ETag writes, and a persisted three-way base. Conflicting or unsupported remote changes become review items.

## Automated checks

`cargo test -p nimble-core --test reminders --test google_calendar --offline`: six focused tests pass, covering decision boundaries, durable claims and restart recovery, title-key stability, DST gap review, merge behavior, deterministic private event projection, and a fake-transport restart without duplicate insertion. `cargo check -p app --offline` passes with the desktop OAuth, Keychain, commands, and runner registered. Full workspace and native signed-bundle gates are coordinated separately.

No real Google events or production task records were touched during implementation.

## Pending live acceptance

- Run a signed synthetic native Mac test: due in three minutes with a two-minute offset; quit/reopen after due; deny OS permission; complete before due; advance recurrence.
- Configure a Desktop OAuth client, verify consent publishing mode and refresh-token longevity, then connect a disposable Google account/calendar.
- Verify a popup on a physical phone and edit the disposable event both directions. Test disconnect/reconnect and restart token persistence.
- Configure the real EDD task only after the disposable task passes. Historical biweekly recurrence-twice acceptance remains open until observed.
