# C2 reminder verification

Current status (2026-09-21): C2 implementation is installed. Synthetic native reminder/restart checks and the live Mac banner passed. Google Calendar connection and initial sync passed after the installed OAuth repair. See [combined verification](c2-c3-verification.md) for evidence and [NEXT.md](../NEXT.md) for current gates. The implementation-stage observations below are historical.

## Implemented boundaries

- A scheduled occurrence is derived from the task's wall date/time, configured IANA timezone, and reminder offset. DST ambiguity uses the earlier instant; nonexistent times surface an error. A title edit retains the occurrence key.
- A device-local SQLite ledger records pending, dispatching, notified, catch-up, acknowledged, and superseded occurrences. Interrupted dispatch resumes as a review item. Due tasks older than 90 seconds enter catch-up without a burst of native banners.
- Native notifications are requested only through the explicit Enable action. A denied or failed notification keeps a catch-up item. Debug builds require an isolated synthetic profile for the runner.
- Google tokens are excluded from SQLite and exports. The Calendar worker uses a dedicated calendar ID, deterministic event IDs, private task marker, ETag writes, and a persisted three-way base. Conflicting or unsupported remote changes become review items.

## Automated checks

`cargo check -p app --offline` passes with the desktop OAuth, Keychain, commands, and runner registered. Full workspace and native signed-bundle gates are coordinated separately.

Final review regressions: eleven focused core tests pass across `reminders`, `google_calendar`, and `google_calendar_http`; the two HTTP tests ran with local loopback access and checked exact request paths, encoded pagination, bearer and If-Match headers, Retry-After, and no sync-token advancement on a failed second page. Four desktop Google tests pass, including reconnecting to the stored calendar without a new POST. The reminder test covers A→B→A restoration before delivery; Google tests cover timezone review and fresh-ETag managed deletion. The signed native reminder smoke test is coordinated separately.

No real Google events or production task records were touched during implementation.

## Remaining live acceptance

- Synthetic submission and restart catch-up are verified. Before closing the wider native checklist, reconcile evidence for OS-permission denial, completion before due and recurrence advancement; do not infer these from the banner test.
- Existing Google Desktop client and dedicated Nimble calendar are connected; reuse them. Confirm testing-mode refresh-token longevity and restart/reconnect persistence.
- Verify a popup on a physical phone and edit the disposable event both directions. Test disconnect/reconnect and restart token persistence.
- Configure the real EDD task only after the disposable task passes. Historical biweekly recurrence-twice acceptance remains open until observed.
