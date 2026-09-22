# C2/C3 implementation verification

Status: implementation, final code review and production installation complete. Google/phone acceptance and agent workflow activation remain open.

## Isolation

Feature branch `codex/c2-c3-reminders-agents`, based on `254bcf1`. Development uses a standalone `Nimble Development Test.app` with identifier `com.marcosevilla.nimble-c23-test`. It points at a marked private temporary profile, not production. Google and existing remote sync are disabled for this synthetic profile. During synthetic development, `/Applications/Nimble.app` and production tasks were unchanged; the subsequent approved production installation is recorded below.

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

Google live failure diagnosis, 2026-09-21: Marco confirmed completing consent and seeing the callback's "Google connected" message. Installed Nimble instead reports that the step could not finish; production `google_calendar_state` has no row. Source review shows callback success HTML is returned before token exchange and omits `client_secret` from both exchange and refresh. A diagnostic token-endpoint request with the configured public client ID, a deliberately invalid code, and random PKCE verifier returned HTTP400 `invalid_request` / `client_secret is missing.` No actual authorization code, access token, refresh token, or client secret was used in that diagnostic. This proves the current request is rejected for the missing desktop-client credential; the original request's detailed response was discarded by the app. Proposed repair and remaining acceptance are tracked in NEXT.md. Marco subsequently approved the repair; implementation and installation evidence follow below.

Google setup, 2026-09-21: Marco approved creating project `nimble-509404`, accepting Google API/Calendar terms and User Data Policy, and creating Desktop OAuth client **Nimble Mac**. Calendar API is enabled, sole test user is Marco's personal Google account, and only `calendar.app.created` is declared. Public client ID was saved through Nimble's form using Enter (Save button did not submit; tracked in NEXT.md). Nimble opened a PKCE/loopback Google authorization flow in Dia and reached the unverified test-app warning. Marco subsequently confirmed consent; token exchange, dedicated-calendar creation, and live sync are not yet verified. No client secret was copied into Nimble or repository files; billing was not enabled.

Production Mac test, 2026-09-21: Marco authorized one reminder test. Installed `dt` created `76f54a61-2149-46d5-9c15-70b8c007fba8` ("Nimble reminder test") due 21:43 America/Los_Angeles with offset 0 and Google publishing disabled; app refresh was acknowledged. Read-only inspection of the production delivery ledger confirmed `notified`, `last_fired_at=2026-09-22T04:43:41.571711+00:00`, and no error. Marco requested a retry; the same task was rescheduled for 21:46. Marco then explicitly confirmed "ok reminder showed up," establishing visible Mac banner acceptance (without attributing it to a particular attempt). The temporary task was completed at 21:46 PDT with app refresh acknowledged.

- [x] Final complete Rust suite outside the macOS filesystem-event sandbox: 320 passed.
- [x] Scoped re-review of fixes; frontend desktop/web builds pass. Final native bundle build is recorded below.
- [x] Reopen test app after a missed reminder and confirm persistent catch-up UI; dismissal removed the item.
- [x] Native OS banner presentation confirmed by Marco in the installed production app on 2026-09-21.
- [ ] Configure Google Desktop OAuth client, consent mode and real account connection.
- [ ] Physical phone alarm and two-way event-edit acceptance.
- [x] Install CLI on PATH and verify its connection to the production app using backup RPC.
- [ ] Agent workflow routing activation and live web propagation acceptance.
- [x] Production app update, following review and user approval.
- [x] Integrate feature branch into main and verify the merged result.

Mocked transport success does not establish phone delivery. Mac reminders need Nimble running; missed occurrences appear on reopen. Already-published Google events can alert while the Mac app is closed, but new changes/current recurrence advancement need Nimble to sync.

## Final native artifact

The final debug test bundle built successfully and was reopened after the review fixes. The previously dismissed reminder remained dismissed; Settings includes Reminders and Phone alerts navigation. The test app was quit after verification. Build log: `/private/tmp/nimble-c23-final-native-build.log`.

Implementation choices: workers shared one isolated feature worktree with exclusive file ownership (requiring coordinated integration), and frontend dependencies were installed separately because symlinking another worktree would resolve stale shared types. Neither choice changes production data or external account state.

## Release packaging

Optimized app compilation passed and `dt` release binary built successfully. The release bundle has production identifier `com.marcosevilla.daily-triage` and no test `LSEnvironment`. Marco approved the macOS signing prompt, and packaging completed with identity `Marco Task App Dev` (signed 2026-09-21 20:53:39 PDT). `codesign --verify --deep --strict --verbose=2` passed outside the sandbox: valid on disk and satisfies its Designated Requirement. The sandbox-only verification initially reported `CSSMERR_TP_NOT_TRUSTED`; verification using macOS trust services outside the sandbox succeeded. This is the existing local developer identity; the bundle was not notarized.

Completed build log: `/private/tmp/nimble-c23-release-build.log`. Signed app: `/Users/marcosevilla/Developer/marco-task-app/.worktrees/nimble-c1/target/release/bundle/macos/Nimble.app`. CLI artifact: `/Users/marcosevilla/Developer/marco-task-app/.worktrees/nimble-c1/target/release/dt`; release `--json --help` succeeds. At the packaging checkpoint, no production installation, code merge, live account setup or agent routing change had occurred. The later installation and integration are recorded below.

## Production installation — 2026-09-21

User approved installation. Saved the previous app, app data and WebKit cache under `~/Library/Application Support/Nimble Rollbacks/20260921-210436-c23` with private data permissions. Installed the verified signed bundle into `/Applications/Nimble.app` and the matching release CLI into `~/.local/bin/dt` (resolves on PATH).

Reopened the app through native UI. Schema migrated from19 to20, `PRAGMA integrity_check` returned `ok`, and the installed executable hash matches the verified release. Counts and hashes over every preexisting column match before/after: 1,124 tasks,63 projects,25 labels,0 sections,150 captures. Settings visibly shows Reminders and Phone alerts; Mac notifications Enabled, timezone `America/Los_Angeles`, Google Not connected. No real task was created or edited for verification.

Installed `dt --json backup now` succeeded through the production app socket: local backup at2026-09-22T04:05:15Z, private online backup acknowledged at04:05:23Z, export commit `674b4a0a4e85a2518393645bfe9e519709a86196`. `dt --json backup verify` returned `verified:true` using isolated recovery. One pending Turso entry was reported at backup time; live web propagation is not claimed.

Phone-alert account setup, physical phone acceptance, independent Mac-banner observation, workflow routing activation remain open. Feature-branch integration is recorded below.

## Main integration — 2026-09-21

User approved local integration of `codex/c2-c3-reminders-agents` at `cbcd21e` into `main` at `d0ce1da`. Only `NEXT.md` conflicted; retained the complete feature record and updated completed installation/integration status. Runtime source, dependencies and tests exactly match the reviewed, installed feature branch. The user-facing documentation name is now **Nimble Agent Tools**; the executable remains `dt`.

Fresh verification on merged main: `cargo test --workspace --offline` passed320 tests with0 failures, both desktop/web production builds passed, and five interface tests passed. Rust ran outside the sandbox for macOS file events and localhost sockets. Logs: `/private/tmp/nimble-c23-main-rust.log`, `/private/tmp/nimble-c23-main-desktop.log`, `/private/tmp/nimble-c23-main-web.log`, `/private/tmp/nimble-c23-main-ui-tests.log`. Existing compiler/bundle-size warnings remain non-blocking. No installed-app rebuild or data change was required.

At this integration checkpoint the merge was local; the subsequent push and web deployment are recorded below. No workflow activation was performed. Feature worktree retained with development evidence and artifacts.

## Production web deployment — 2026-09-21

User approved push and deploy. Fetched GitHub and confirmed main was19 commits ahead with no remote divergence, then pushed `49254e9` to `marcosevilla/nimble` main. Published the clean checkout with `vercel deploy --prod --yes` to the existing `nimble-web` project.

- Deployment: `dpl_9aNWreqb49Ho9KocRGypNDu8BLnE`, status **Ready**, target production.
- Production alias: https://nimble-web-marco-sevilla-projects.vercel.app
- Immutable deployment: https://nimble-f77wzmy7q-marco-sevilla-projects.vercel.app
- Previous production (rollback reference): `dpl_CYgrZGFPsGEgmheA9oN9xw48CD9e`, https://nimble-1p22mtlrg-marco-sevilla-projects.vercel.app
- Vercel inspection confirms `api/login`, `api/turso` and middleware are present. Cloud web build passed.

Live checks: HTML GET `/` returns200 with the password form; GET `/` without HTML Accept returns401; unauthenticated POST `/api/turso` returns401 with Nimble's `Unauthorized` response; wrong-password POST `/api/login` returns401 without timeout. Browser independently renders the Nimble Unlock page at the production alias. The installed desktop reports both v19 and v20 Turso schema upgrades completed.

Signed-in app and authenticated database checks were not completed: both Vercel environment-run and explicit production environment export returned an empty `WEB_PASSWORD` value. The browser has no signed-in session. The private temporary environment copy was removed, no credentials were changed, and no task data was written. These deployment checks do not establish live end-to-end reminder/agent web propagation.

Build log: `/private/tmp/nimble-c23-production-deploy.log`. Credential-limited verification log: `/private/tmp/nimble-c23-live-check.log`. Google connection, physical phone acceptance and agent routing remain separate activation work.

## Google OAuth repair — 2026-09-21

Approved repair in `codex/google-desktop-oauth-fix`. The Desktop OAuth client secret is entered through Settings > Phone alerts > Google connection setup, stored only in macOS Keychain under a separate service, and bound to the device profile and public client ID. SQLite stores only the public ID. Both initial token exchange and refresh now include the secret. Callback copy reports approval received, with final connection status checked in Nimble. Save setup and Save timezone use explicit submit buttons. Rejected client credentials are persisted as a visible connection error; successful reconnect/sync clears the error.

Regression evidence: transport, client/profile storage isolation, public-ID-only persistence, bound-client replacement guard, blank-secret rejection, actual-render masked field and form submission tests demonstrated failing before the repair and passing afterward. Desktop/web production builds, eight frontend tests and targeted lint pass. Final Rust suite passed all 330 tests, including the credential-status regression after review. Logs: `/private/tmp/nimble-google-tests-final.log`, `/private/tmp/nimble-google-ui-tests.log`, `/private/tmp/nimble-google-build.log`, `/private/tmp/nimble-google-lint.log`. Independent final review found no remaining blockers. Signed release from `af39e29` built with `Marco Task App Dev`, passed strict signature verification, and installed at `/Applications/Nimble.app`. Native Settings shows the new masked secret field, disabled Save until input, and Not connected / Not configured truthfully. Full-row hashes for all 1,125 tasks, 63 projects, 25 labels, 0 sections and 150 captures match before/after relaunch; schema20 integrity is OK. Rollback app/data: `~/Library/Application Support/Nimble Rollbacks/20260921-222607-google-oauth`. Installed binary hash matches the verified build. CLI and web deployment unchanged. Source remains on the local repair branch. Build log: `/private/tmp/nimble-google-release.log`.

Live acceptance still requires entering the existing Desktop client's secret into the installed app, reconnecting Google, verifying the dedicated Nimble calendar and testing a phone alert. The existing Google project/client must be reused. Never paste the secret into chat or documentation.
