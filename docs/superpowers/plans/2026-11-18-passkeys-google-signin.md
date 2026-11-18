# Passkeys and Google Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passkeys as the primary sign-in where the device supports them, and invite-gated Google sign-in with no authenticator code, on the web app and the native app.

**Architecture:** Better Auth's `@better-auth/passkey` plugin and built-in Google provider in `packages/auth`, guarded like the existing sign-up guard. Server-side helpers in `packages/server` accept invites for Google-created accounts and expose sign-in facts through `auth.me` and two small auth procedures. Web and native screens put the passkey first, Google second, email + password last.

**Tech Stack:** Better Auth 1.6.9, `@better-auth/passkey` 1.6.9 (`@simplewebauthn/server` 13), Drizzle + D1, Hono/tRPC on Cloudflare Workers, Vite + React + TanStack Router, Expo SDK 55 + `@better-auth/expo` + `react-native-passkey` 3.x, `expo-web-browser`.

**Spec:** `docs/superpowers/specs/2026-11-18-passkeys-google-signin-design.md`

## Global Constraints

- Branch `feat/passkeys-google`, worktree `/Users/abhalala/Documents/business/fc/wt/orrn-auth`. Never touch the main checkout `fc/orrn`.
- Follow AGENTS.md. Gates (Testing rules): `bun run check-types`; `bun run --cwd packages/server test` (or `test:server:files` per file); `bun run --cwd packages/i18n test`; `bun run --cwd apps/web test`; `bun run --cwd apps/web build`; `bun run --cwd apps/native test` and `check-types` when native is touched.
- Never run two heavy gates at once in this worktree; never kill processes you did not start; delete `apps/server/.wrangler/logs`, `apps/web/test-results`, `apps/web/playwright-report`, `apps/web/dist` before finishing.
- Migrations are additive; the new one is `0050_*`, chained off 0049's snapshot.
- Auth cookies stay host-only `__Host-better-auth.*`; never set a cookie Domain or `crossSubDomainCookies`.
- No public sign-up: Google never creates an account for an email without a live invite.
- Every new word in en, hi and gu (`packages/i18n`).
- Error codes (exact strings): `GOOGLE_NOT_INVITED`, `GOOGLE_NOT_FOR_STAFF`, `LAST_SIGN_IN_METHOD`, `OWNER_NEEDS_STRONG_METHOD`.
- Secrets and native values are optional: unset `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` hides Google; unset `ORRN_APPLE_TEAM_ID` / `ORRN_ANDROID_CERT_SHA256` hides native passkeys. Nothing breaks when they are unset.
- Never log credential ids, public keys, Google tokens, invite tokens or links.
- Never run the production promotion (`docs/DEPLOY_PROMOTION.md`). Do not push or open the PR; the lead does.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A Google account whose email has an invite that expired or was revoked a minute ago: refused with `GOOGLE_NOT_INVITED`, no user row (Task 2 test `google create refused for expired and revoked invites`).
2. A person with live invites in two plants signs in with Google for the first time: both memberships made, two audit rows, lands on the plant switcher (Task 2 test `google create accepts every live invite`).
3. A browser without WebAuthn (old Android WebView, Firefox with it disabled): no passkey button, password form is the main form (Task 4 test `no passkey button without PublicKeyCredential`).
4. User cancels the Face ID / Touch ID sheet: an inline "Passkey sign-in was cancelled" message, form still usable, no error toast (Task 4 test `cancelled passkey shows inline message`).
5. An owner with password + passkey removes the passkey while two-factor is off: refused `OWNER_NEEDS_STRONG_METHOD` (Task 3 test `owner cannot drop last strong method`).

---

### Task 1: Passkey plugin, migration and public sign-in config

**Files:**
- Modify: `packages/auth/package.json` (add `@better-auth/passkey` `1.6.9`; also add to the root catalog if the repo pins better-auth packages there)
- Create: `packages/auth/src/passkey-config.ts`
- Modify: `packages/auth/src/index.ts` (register the plugin)
- Modify: `packages/db/src/schema/auth.ts` (the plugin's `passkey` table)
- Create: `packages/db/src/migrations/0050_passkey.sql` + snapshot + `_journal.json` entry (generated the repo's way, `docs/LOCAL_DEV.md`)
- Modify: `packages/env/env.d.ts` (`ANDROID_APK_KEY_HASH?: string`)
- Modify: `packages/server/src/routers/auth.ts` (public `auth.methods`)
- Modify: `packages/server/src/lib/backup.ts` only if the backup test demands the new table be listed
- Test: `packages/server/test/auth-passkey.test.ts`

**Interfaces:**
- Produces: `passkeyConfigFor(webUrl: string, androidApkKeyHash?: string): { rpID: string; rpName: "ORRN"; origin: string[] }` — `rpID` is the host of `webUrl` (`orrn.in`, `dev.orrn.app`, `localhost`), `origin` is `[new URL(webUrl).origin]` plus `"android:apk-key-hash:" + hash` when the hash is set. Read `webUrl` from the same environment value `packages/server/src/lib/webUrl.ts` uses.
- Produces: tRPC `auth.methods` (public query) → `{ google: boolean; passkey: { rpID: string } }`.

- [ ] **Step 1: Write failing tests** in `auth-passkey.test.ts`:
  - `passkeyConfigFor("https://orrn.in")` → `{ rpID: "orrn.in", rpName: "ORRN", origin: ["https://orrn.in"] }`; with hash `"abc"` origin is `["https://orrn.in", "android:apk-key-hash:abc"]`; `passkeyConfigFor("http://localhost:3001").rpID === "localhost"`.
  - `passkey registration options need a session`: unauthenticated `GET /api/auth/passkey/generate-register-options` → 401.
  - `passkey registration options use the stage rpID`: signed-in user gets options whose `rp.id` equals the test stage's web host and `authenticatorSelection.residentKey === "required"`.
  - `passkey sign-in options are public`: `/passkey/generate-authenticate-options` (exact path from the installed plugin) answers 200 with a `challenge` and `rpId`.
  - `auth.methods without Google secrets`: `{ google: false, passkey: { rpID } }`.
- [ ] **Step 2: Run** `bun run --cwd packages/server test test/auth-passkey.test.ts` → FAIL (module/route missing).
- [ ] **Step 3: Implement.** Check option names in `node_modules/@better-auth/passkey` (do not rely on memory). Set resident key required, user verification preferred. If `@simplewebauthn/server` fails on the Worker/Miniflare, stop and report.
- [ ] **Step 4: Run** the test file → PASS; `bun run check-types` → clean; the backup schema test still passes.
- [ ] **Step 5: Commit** `feat(auth): passkey plugin, migration 0050 and auth.methods`.

### Task 2: Google provider, invite guard and onboarding

**Files:**
- Modify: `packages/auth/src/index.ts` (`socialProviders.google`, account linking with Google trusted, the create guard, the after-create hook)
- Create: `packages/auth/src/google-guard.ts`
- Create: `packages/server/src/lib/acceptInvite.ts` (moved out of `routers/invite.ts`)
- Modify: `packages/server/src/routers/invite.ts` (`acceptByToken` calls `acceptInvite`)
- Modify: `packages/env/env.d.ts` (`GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`)
- Modify: `packages/server/src/infra/alchemy.run.ts`, `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml` (bind both, secret encrypted, both-or-neither warning, deploy log line "Google -> configured" / "not configured")
- Test: `packages/server/test/auth-google.test.ts`

**Interfaces:**
- Produces: `googleCreateAllowed(db, email: string, now?: Date): Promise<boolean>` — true when a live invite (not accepted, not revoked, `expiresAt > now`, any company, kind member or portal) exists for the lower-cased email.
- Produces: `isPlatformStaff(db, userId: string): Promise<boolean>` — true when the user has a platform role (use the same source `platformProcedure` uses).
- Produces: `acceptInvite(db, actor: { session; impersonation }, invite: InviteRow, userId: string): Promise<{ success: true }>` — exactly today's `acceptByToken` body after the token lookup and email check (portal branch, party refusal, membership insert, `acceptedAt`, `member.invite.accept` audit).
- Produces: `acceptLiveInvitesFor(db, userId: string, email: string): Promise<number>` in `acceptInvite.ts` — accepts every live invite for the email, skipping (and logging by invite id) any that `acceptInvite` refuses; returns how many were accepted.
- Wiring: `packages/auth` cannot import `@orrn/server`. Add `configureAuthHooks({ acceptLiveInvitesFor })` exported from `packages/auth`; `packages/server` calls it once at module load next to `createAuth`. The Google after-create hook calls the configured function.

Behaviour (spec Design §4–6):
- Create via Google only if `googleCreateAllowed`; else redirect to `<web>/login?error=GOOGLE_NOT_INVITED` (trusted origin) with no user row.
- After create via Google: `emailVerified = true`, then `acceptLiveInvitesFor`.
- Existing user, Google sign-in: if `isPlatformStaff` → refuse `GOOGLE_NOT_FOR_STAFF` (redirect `<web>/login?error=GOOGLE_NOT_FOR_STAFF`). Else link. If the user was `emailVerified: false`: delete their credential password, end every other session, set `emailVerified = true`. If already verified: link only.
- Only verified Google emails (`email_verified` claim) are accepted.

- [ ] **Step 1: Write failing tests** (configure the Google provider in the test env with a stubbed `verifyIdToken`/`getUserInfo` and drive `POST /sign-in/social` with `{ provider: "google", idToken }`, so no network is used):
  - `google create allowed with a live invite` → session returned, user `emailVerified` true, membership exists, invite `acceptedAt` set.
  - `google create refused without an invite` → `GOOGLE_NOT_INVITED`, no user row.
  - `google create refused for expired and revoked invites` → same, for each.
  - `google create accepts every live invite` → two plants, two memberships, two `member.invite.accept` audit rows.
  - `google sign-in on account with two-factor needs no code` → session returned, no `twoFactorRedirect`.
  - `google links to a verified account and keeps the password` → credential account still has a password; old session still valid.
  - `google on an unverified account drops the password and other sessions` → credential password null, previous session rejected, `emailVerified` true.
  - `google refused for platform staff` → `GOOGLE_NOT_FOR_STAFF`, no account row added.
  - `unverified google email refused`.
  - `invite.acceptByToken behaves as before` — the existing invite tests keep passing unchanged.
- [ ] **Step 2: Run** the file → FAIL.
- [ ] **Step 3: Implement** per Interfaces and Behaviour.
- [ ] **Step 4: Run** `auth-google.test.ts`, `auth-signup-invite.test.ts`, `final-explore-invite.test.ts`, `platform-w1-auth.test.ts` → PASS; `check-types` clean.
- [ ] **Step 5: Commit** `feat(auth): invite-gated Google sign-in that onboards and skips the code`.

### Task 3: Sign-in facts, link guard, strong-method rule, audit

**Files:**
- Modify: `packages/server/src/routers/auth.ts` (`auth.me` user fields; `auth.signInMethods`)
- Modify: `packages/auth/src/magic-link-guard.ts` and `packages/server/src/routers/platform/waitlist.ts` (`ownerAccount`, `waitlistAwaitingSignIn`)
- Modify: `packages/auth/src/index.ts` (before-hook: last-method and owner strong-method refusals on passkey delete, two-factor disable, account unlink)
- Create: `packages/auth/src/sign-in-methods.ts`
- Modify: `apps/web/src/shared/lib/home.ts` (`needsPassword`)
- Modify: audit words list `apps/web/src/features/audit/action-words.ts` + en/hi/gu, only if audit rows are company-scoped (see below)
- Modify: `AGENTS.md` (Sign-in facts, Magic links, No public sign-up bullets)
- Test: `packages/server/test/auth-sign-in-methods.test.ts`; `apps/web/src/features/auth/welcome-steps.test.ts`

**Interfaces:**
- Produces: `signInMethodsFor(db, userId): Promise<{ password: boolean; passkeys: number; google: boolean; authenticator: boolean }>` in `sign-in-methods.ts`.
- Produces: `auth.me.user.hasPasskey: boolean`, `auth.me.user.hasGoogle: boolean`.
- Produces: tRPC `auth.signInMethods` (authed) → `{ password: boolean; authenticator: boolean; google: boolean; passkeys: { id: string; name: string | null; createdAt: Date; lastUsedAt: Date | null }[]; isOwnerAnywhere: boolean }`.
- Produces (web): `needsPassword(me) = me.user.mustChangePassword === true || (!me.user.hasPassword && !me.user.hasPasskey && !me.user.hasGoogle)`; `hasStrongMethod(me) = me.user.twoFactorEnabled || me.user.hasPasskey || me.user.hasGoogle` exported from `welcome-steps.ts`; the owner `twoFactor` step is pushed only when `!hasStrongMethod(me)`.
- Audit: if `audit_log.company_id` is NOT NULL, write `auth.passkey.add|remove` and `auth.google.link` through `writeAuthLog` (no company) instead of `audit_log`; otherwise write audit rows with words in en/hi/gu.

- [ ] **Step 1: Write failing tests:**
  - `auth.me reports passkey and google` (insert a passkey row and a google account row directly).
  - `magic link refused for passkey-only account` and `... for google-only account`.
  - `waitlist awaiting sign-in skips owners with a passkey or google`.
  - `last sign-in method cannot be removed` → deleting the only passkey of a passkey-only user → `LAST_SIGN_IN_METHOD`.
  - `owner cannot drop last strong method` → owner with password + one passkey, two-factor off, deletes passkey → `OWNER_NEEDS_STRONG_METHOD`; same owner with two-factor on → allowed.
  - web: `welcomeSteps` omits `twoFactor` when `hasPasskey` or `hasGoogle`; `needsPassword` false for a google-only user.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two test files plus `bun run --cwd apps/web test` and server auth tests → PASS.
- [ ] **Step 5: Commit** `feat(auth): sign-in facts, link guard and the strong-method rule`.

### Task 4: Web login and invite pages

**Files:**
- Modify: `apps/web/package.json` (`@better-auth/passkey` for the client plugin), `apps/web/src/shared/lib/auth-client.ts` (`passkeyClient()`)
- Create: `apps/web/src/features/auth/passkey-support.ts`
- Create: `apps/web/src/features/auth/alt-sign-in.tsx` (passkey + Google buttons and their errors)
- Modify: `apps/web/src/features/auth/sign-in-form.tsx`, `apps/web/src/features/auth/auth-errors.ts`
- Modify: `apps/web/src/routes/_public/login.tsx` (read `?error=`), `apps/web/src/routes/_public/invite.$token.tsx` (Google with `callbackURL` = this invite page)
- Modify: `packages/i18n` en/hi/gu
- Test: `apps/web/src/features/auth/passkey-support.test.ts`, `apps/web/src/features/auth/auth-errors.test.ts`, e2e `apps/web/tests/e2e/sign-in-methods.spec.ts` (+ `GROUPS.md` and the group script)

**Interfaces:**
- Consumes: `auth.methods` (Task 1), error codes (Global Constraints).
- Produces: `passkeySupport(win?: Window): { available: boolean; conditional: Promise<boolean> }` — `available` is `typeof win.PublicKeyCredential === "function"`; `conditional` resolves `PublicKeyCredential.isConditionalMediationAvailable?.()` or false.
- Produces: `signInErrorKey` handles the four new codes plus passkey `NotAllowedError` (cancelled) → keys `auth.errors.googleNotInvited`, `auth.errors.googleNotForStaff`, `auth.errors.passkeyCancelled`, `auth.errors.passkeyNotFound`.

Layout (top to bottom): "Sign in with a passkey" (primary button, only when `available`), "Continue with Google" (only when `auth.methods.google`), divider "or", the email + password form as today (when no passkey button shows, this form keeps today's primary look). Email input `autocomplete="username webauthn"`; when `conditional` is true, start `authClient.signIn.passkey({ autoFill: true })` on mount and abort it on unmount. After a passkey or Google sign-in, the same `finish` as today runs.

- [ ] **Step 1: Write failing tests:** `passkeySupport` with and without `PublicKeyCredential`; `auth-errors` maps each new code; e2e `no passkey button without PublicKeyCredential` (delete it with `addInitScript`), `cancelled passkey shows inline message` (virtual authenticator via CDP `WebAuthn.enable` with no credential → NotAllowed), `google error from callback shows inline` (`/login?error=GOOGLE_NOT_INVITED`), `passkey sign-in end to end` (CDP virtual authenticator: register in Settings, sign out, sign in with the passkey, land on /today without a code).
- [ ] **Step 2: Run** unit tests → FAIL.
- [ ] **Step 3: Implement**; words through the existing en/hi/gu files.
- [ ] **Step 4: Run** `bun run --cwd apps/web test`, `bun run --cwd packages/i18n test`, `bun run --cwd apps/web build`, and the new e2e spec (after Task 5 lands the Settings add flow) → PASS. Visual check at 375/820/1280 in en and hi with axe.
- [ ] **Step 5: Commit** `feat(web): passkey-first sign-in, Google and the invite page`.

### Task 5: Web welcome step and Settings > Sign-in

**Files:**
- Modify: `apps/web/src/features/auth/welcome/two-factor-step.tsx` (becomes "Secure your sign-in": passkey first when available, authenticator app as the second choice) and `apps/web/src/routes/_authed/welcome.tsx`
- Create: `apps/web/src/features/settings/sign-in-tab.tsx`
- Modify: `apps/web/src/features/settings/sections.tsx` (tab `{ id: "sign-in", labelKey: "settings.tabs.signIn" }`, no `requires`)
- Modify: `packages/i18n` en/hi/gu
- Test: `apps/web/src/features/settings/sign-in-tab.test.ts` (pure helpers), e2e additions in `sign-in-methods.spec.ts`

**Interfaces:**
- Consumes: `auth.signInMethods`, `hasStrongMethod`, `passkeySupport`, the server refusals (Task 3).
- Produces: `canRemove(methods, target: "passkey" | "google" | "authenticator", isOwner: boolean): { ok: true } | { ok: false; code: "LAST_SIGN_IN_METHOD" | "OWNER_NEEDS_STRONG_METHOD" }` — same rule as the server, used to disable buttons with the reason shown; the server stays the judge.

Settings > Sign-in rows: Passkeys (list with name, added, last used; Add, Rename, Remove), Google (Linked / Link), Password (Set / Change), Authenticator app (On / Off, existing flow). Non-owners on the web get a skippable "Add a passkey for faster sign-in" step after first sign-in when `passkeySupport().available` and they have none.

- [ ] **Step 1: Write failing tests** for `canRemove` (each code) and the welcome order.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web unit tests, i18n tests, build, e2e `sign-in-methods.spec.ts` → PASS; visual check as in Task 4.
- [ ] **Step 5: Commit** `feat(web): secure-your-sign-in step and Settings > Sign-in`.

### Task 6: Native passkeys, Google and domain association

**Files:**
- Modify: `apps/native/package.json` (`react-native-passkey` 3.x, `expo-web-browser` SDK 55 version via `npx expo install`)
- Create: `apps/native/plugins/with-passkey-domains.js` (iOS `com.apple.developer.associated-domains: ["webcredentials:<rpID>"]` from `ORRN_PASSKEY_RP_ID`, default `orrn.in`; added to `app.json` plugins)
- Create: `apps/native/lib/passkey.ts`, `apps/native/features/auth/alt-sign-in.tsx`
- Modify: `apps/native/app/(auth)/sign-in.tsx`, `apps/native/app/invite/[token].tsx`, `apps/native/app/more/settings.tsx`, native auth client file (wherever `expoClient` is configured)
- Create: `apps/web/scripts/well-known.ts` run by the web build: writes `dist/.well-known/apple-app-site-association` (`{"webcredentials":{"apps":["<ORRN_APPLE_TEAM_ID>.in.orrn.app"]}}`) and `dist/.well-known/assetlinks.json` (relation `delegate_permission/common.get_login_creds`, package `in.orrn.app`, `sha256_cert_fingerprints: [ORRN_ANDROID_CERT_SHA256]`) only when the values are set; served with `content-type: application/json`
- Modify: `packages/i18n` (native strings, en/hi/gu)
- Test: `apps/native/__tests__/passkey.test.ts`, `apps/web/scripts/well-known.test.ts`

**Interfaces:**
- Consumes: `auth.methods` (Task 1), the passkey endpoints (generate options / verify) and `/sign-in/social`.
- Produces: `nativePasskey: { supported(): Promise<boolean>; signIn(): Promise<void>; add(name: string): Promise<void> }` in `lib/passkey.ts` — calls the plugin's generate-options endpoint, hands options to `react-native-passkey`, posts the result to the verify endpoint with the stored session cookie (the `@better-auth/expo` client's fetch).
- Google: `authClient.signIn.social({ provider: "google", callbackURL: "/" })` (invite screen: `callbackURL` = `/invite/<token>`), with the browser opened as an ephemeral session (`preferEphemeralSession: true` / the `@better-auth/expo` equivalent).

Rules (spec, Native and Shared floor phones): passkey sign-in button first when `supported()`; adding a passkey only from Settings, after a confirm "Is this your own phone?" with the shared-phone warning; owners and admins see a welcome prompt, floor roles do not; native passkey UI hidden when `auth.methods` reports no native association (add `native: { ios: boolean; android: boolean }` to `auth.methods`, true when `ORRN_APPLE_TEAM_ID` / `ANDROID_APK_KEY_HASH` are bound on the server).

- [ ] **Step 1: Write failing tests:** `passkey.test.ts` (unsupported → no button state; options round trip with a mocked module and mocked fetch); `well-known.test.ts` (both files with values; no files without values; exact JSON).
- [ ] **Step 2: Run** `bun run --cwd apps/native test` and the web script test → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** native test + `check-types`, web test + build → PASS. (Simulator run is out of scope for this task per the owner; note it as untested on device.)
- [ ] **Step 5: Commit** `feat(native): passkey sign-in, Google and passkey domain association`.

### Task 8: Onboarding repair (every invite state, resend, copyable link)

Why (prod evidence 2026-11-18): Dad's account `bhavesh28777@gmail.com` was made by an October magic-link approval and has no credential. On the invite page "Create account" got 422 (account exists) and "Sign in" got 401 "Credential account not found" six times, with no third path. Lalu uncle's invite email (ymail.com) may never have arrived, and an inviter cannot resend or copy a pending invite's link because only the token hash is stored.

**Files:**
- Modify: `packages/server/src/routers/invite.ts` (public `invite.status`; authed `invite.resend`)
- Modify: `apps/web/src/routes/_public/invite.$token.tsx` (views per account state, Google button, set-password-by-email path)
- Modify: `apps/web/src/features/auth/auth-errors.ts` (map "Credential account not found" / `CREDENTIAL_ACCOUNT_NOT_FOUND` to `auth.errors.noPasswordYet` with an action)
- Modify: `apps/web/src/features/auth/sign-in-form.tsx` (on that error, offer "Email me a link to set a password", which calls `requestPasswordReset` for the typed email)
- Modify: `apps/web/src/routes/_public/forgot-password.tsx` / reset page so a `next` path (same-origin, `safeNext`) survives the reset and returns the person to `/invite/<token>`
- Modify: Team tab pending invites (web `features/settings/team*`) — "Resend" and "Copy link"
- Modify: `apps/native/app/invite/[token].tsx` (same states as web)
- Modify: `packages/i18n` en/hi/gu; `AGENTS.md` (invite bullets)
- Test: `packages/server/test/invite-onboarding.test.ts`, web unit tests for the view choice, e2e `apps/web/tests/e2e/invite-onboarding.spec.ts` (+ GROUPS.md and group script)

**Interfaces:**
- Consumes: `auth.methods` (Task 1), Google guard + idempotent `acceptByToken` (Task 2), `signInMethodsFor` (Task 3), the Google/passkey buttons component from Task 4 (`alt-sign-in.tsx`) and Task 6 (native).
- Produces: `invite.status({ token })` (public, rate-limited like the reset throttle: 30 per 10 min per IP via `auth_throttle`) → `{ live: false } | { live: true; kind: "member" | "portal"; account: "none" | "password" | "noPassword"; google: boolean }`. It never returns the email, the company name or the role. It replaces the page's `probeInvite` accept-as-probe.
- Produces: `invite.resend({ inviteId })` (`member.invite`, same company, kind member, pending only) → `{ link: string; emailSent: boolean; expiresAt: Date }`. Rotates the token (new hash, `expiresAt` = now + 7 days), re-sends the same email as `invite.create`, audit `member.invite.resend` (meta: email, role; never the link). Old link stops working.

Invite page views (web and native), chosen from `invite.status` and the session:
- dead → today's expired view.
- signed in as the invite email → "Join" (today).
- signed in as another email → today's wrong-account view.
- `account: "none"` → create account (today) plus Google when `google`.
- `account: "password"` → sign in (passkey, Google, email + password) then join.
- `account: "noPassword"` → "Your account doesn't have a password yet." Primary: Google when available; second: "Email me a link to set a password" (reset email to the address the person types, which must be the invite email; reset returns to this invite page); after either, join.
Team tab: each pending invite row has "Resend" (shows the copy-link dialog with `link`, and says whether the email went) and the dialog warns that link previews in chat apps are fine (the invite page never accepts on load).

- [ ] **Step 1: Write failing tests:** server `invite.status` for dead / none / password / noPassword / google flag, never leaks email; `invite.status throttled after 30`; `invite.resend rotates the token` (old token dead, new token live, email sent, audit row); `invite.resend refused for accepted, revoked, portal, other company, non-inviter roles`. Web unit: view choice for each status. e2e: magic-link-style account (no credential) with a live invite → "Email me a link to set a password" → `/dev/` hook reads the reset link → set password → returns to invite → joined.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** server files, web unit + build, native test + check-types, i18n, the e2e spec → PASS. Visual check 375/820/1280 en + hi.
- [ ] **Step 5: Commit** `fix(onboarding): every invite state has a way in; resend and copy invite links`.

### Task 7: Whole-branch gates and docs

**Files:**
- Modify: `docs/DEPLOYMENT.md` / `docs/OWNER_HANDOVER.md` (Google OAuth client steps with the exact redirect URIs; Apple Team ID and Android SHA-256 inputs; GitHub secret names)
- Modify: `AGENTS.md` if any rule above is not yet written down

- [ ] **Step 1: Run every gate** in Global Constraints, one at a time → all PASS; e2e groups that contain sign-in specs pass with `E2E_WORKERS=2`.
- [ ] **Step 2: Disk hygiene** (delete the four directories).
- [ ] **Step 3: Commit** `docs(auth): owner steps for Google and native passkeys`.
