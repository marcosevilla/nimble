# Google Desktop OAuth repair implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement these tasks with regression checks and independent review.

**Goal:** Finish the approved Google connection by correcting desktop client authentication and truthful setup feedback, then install a verified release.
**Architecture:** Keep the existing PKCE flow and dedicated-calendar scope. Store the desktop client secret in a separate Keychain service, bound to the local profile and selected public client ID. Pass it only to Google's token endpoint. Expose only a configured boolean to React; a write-only command saves setup.
**Tech Stack:** Tauri/Rust/keyring, React/TypeScript/Base UI.
**Spec:** User-approved repair proposal recorded in NEXT.md and docs/c2-c3-verification.md.

## Global constraints
- Preserve existing tasks, Google project/client, refresh-token Keychain service, calendar ownership checks, and opt-in publishing.
- No client secrets in SQLite, Turso, portable backups, logs, status responses, or source files.
- Development/synthetic/demo modes cannot write production credentials or access Google.
- No migration or new dependency required. No push/deployment authorized in this repair request.

## Task 1: Token exchange and callback (worker owns google_oauth.rs)
- [x] Add local HTTP regressions for exchange/refresh fields and sanitized error responses; run failing tests.
- [x] Change signatures to `authorize(client_id, client_secret, client)` and `refresh(client_id, client_secret, refresh_token, client)`.
- [x] Include `("client_secret", client_secret)` in both form bodies and reject empty client configuration before network use.
- [x] Return static error codes `google_client_config_missing` / `google_client_config_rejected`; no response-body propagation.
- [x] Replace premature callback success with `Google approval received. Return to Nimble to check connection status.` Compute Content-Length, close the socket, retain state/PKCE safeguards.
- [x] Run focused Rust tests and review.

## Task 2: Secure setup and UI (controller)
Files: google_credentials.rs, commands/google_calendar.rs, google_calendar_runner.rs, lib.rs, packages/types/src/index.ts, services/tauri.ts, tauri-provider.ts, turso-provider.ts, GoogleCalendarSection.tsx.
- [x] Add regression for client-secret isolation across profiles and client IDs. Add rendered form regression for the real Base UI submit button.
- [x] Add `KeychainClientCredentials` implementing existing GoogleCredentials with a separate service and hashed profile/client account key. Do not change refresh-token namespace.
- [x] Add command `google_calendar_configure(client_id:String, client_secret:String)` returning GoogleConnectionStatus with `clientSecretConfigured: boolean`. Validate public ID suffix/nonempty secret; hold existing connection lock; reject changing client ID while an existing calendar/session is bound. Write Keychain before SQLite public ID.
- [x] Status checks only whether the secret is configured; connect/runner load the bound secret and pass to Task 1.
- [x] Add `configure(clientId:string,clientSecret:string)` to shared capability and every active provider. Web returns unsupported.
- [x] Add masked setup input with empty initial value, `autoComplete="off"`, no readback; clear React secret immediately after successful save. Use explicit `type="submit"`. Map static errors to actionable copy. Keep connect unavailable until setup is configured.
- [x] Correct the adjacent reminder timezone form submit type because it has the same defect.

## Task 3: Verify and install
- [x] Run Rust suite, interface tests, desktop/web builds; independent review of auth and storage boundaries.
- [x] Update setup docs and NEXT.md to describe actual client-secret requirements and remaining live acceptance.
- [x] Build signed release using existing development signing identity; verify signature.
- [x] Quit installed app, save private rollback app/data, install verified app, reopen, check task data/schema unchanged and setup fields visible.
- [ ] Let Marco enter the client secret from his existing Google Desktop client into the new write-only field; retry consent and verify actual connected status/calendar. Do not claim live success before that acceptance.
