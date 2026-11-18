# Passkeys and Google sign-in (web and native)

Date: 2026-11-18. Owner request, this thread. Status: design.

## Intent

Signing in to orrn should be easy for the people who run the plant: Dad (Bhavesh) and Lalu uncle, who are not
technical. Today they type an email, a password and a 6-digit authenticator code every time. It should also be more
secure for everyone. The owner said both reasons count ("both needs it"), and both the web app (orrn.in) and the
native app (apps/native) get the change.

Two new ways in:

1. **Passkeys.** Anyone whose device supports them (Face ID, Touch ID, Windows Hello, Android fingerprint or screen
   lock, a password manager) can add one and then sign in with it. Where the device supports passkeys, a passkey is
   the **primary** way to sign in. Email + password + authenticator code becomes the fallback.
2. **Google.** "Continue with Google" works only for an email that orrn already knows: an email with a live invite
   (not accepted, revoked or expired), or an existing account. Someone with a live invite who signs in with Google
   is onboarded (account made, invite accepted through the existing invite page). **No authenticator code is asked
   after a Google sign-in.**

## Goals

- Passkey sign-in on web (Chrome, Safari, Edge, Firefox) and on the iOS and Android apps.
- Passkey shown first wherever the device can do it; the browser's autofill also offers saved passkeys from the email
  field (WebAuthn conditional mediation).
- Adding a passkey is offered in the welcome steps and in a new Settings > Sign-in section, where people also see and
  remove their passkeys.
- Google sign-in on web and native for invited or existing emails; existing accounts get Google linked to them.
- A passkey or Google sign-in never asks for the authenticator code. A passkey is already two factors (the device and
  the face, finger or PIN); Google sign-in is the owner's explicit decision.
- The owner rule "every first-setup owner must finish two-factor setup" (AGENTS.md, Sign-in facts, Q2 A) is met by
  any one of: authenticator app turned on, a passkey added, or Google linked.

## Non-goals

- No public sign-up. Google never creates an account for an email orrn does not already know (D14, security review
  2026-11-04 HIGH 3 stay in force).
- Passwords are not removed. Email + password (+ code when enabled) stays as the fallback on every surface.
- No other social providers (Apple, Microsoft) now.
- No passkey sign-in on plant kiosks or edge screens (orrn-spool); those keep their own flows.

## Anti-goals (a failure even if it works)

- Anyone getting into orrn with a Google account whose email has no invite and no account.
- A Google or passkey path that skips the impersonation, membership, device-revoke or plant-switch rules.
- Sign-in becoming harder for Dad and Lalu: the passkey button must be one tap, and a device without passkeys must
  never show a broken passkey button.
- Changing auth cookies (host-only `__Host-better-auth.*` on the API host stays exactly as it is).

## Constraints (from the code today)

- Better Auth 1.6.9 (`catalog:`), Drizzle on D1, the Worker on Cloudflare. `packages/auth/src/index.ts` builds the
  auth instance per environment. The before-hook already runs `signUpGuardBody`, the reset throttle and the
  magic-link guard.
- The two-factor plugin only steps in on `/sign-in/email`; social and passkey sign-ins do not hit it. That is the
  behaviour we want, and a test must pin it.
- `auth.me` returns `hasPassword` and `twoFactorEnabled`; `welcomeSteps` (web) and `needsPassword` decide the
  welcome steps. A Google-only or passkey-only account has no password, so `needsPassword` must stop forcing one on
  them.
- Migrations are additive and numbered (`packages/db/src/migrations`, next is 0050). Backups export every table with
  `company_id` and drop secret columns. The new passkey table has no `company_id`; it holds a public key, not a
  secret, but the credential id and counter stay out of logs.
- Web origin `https://orrn.in`, API `https://api.orrn.in`; dev web `dev.orrn.app`; local `localhost`. The passkey
  relying party is the web origin's host (`orrn.in` in production), with the origins list per stage.
- Native app: Expo SDK 55, expo-router, `@better-auth/expo`, scheme `orrn://` (already a trusted origin), bundle id
  `in.orrn.app` on both platforms.
- i18n: every new word in en, hi and gu (`gu.test.ts` fails on a missing key).
- Agents never run the production promotion (`docs/DEPLOY_PROMOTION.md`).

## Approaches

| | What | Trade-off |
|---|---|---|
| **A (picked)** | Better Auth's own add-ons: `@better-auth/passkey` (same 1.6.x line) and the built-in Google social provider, behind the existing guard style. Native passkeys through a small native module (`react-native-passkey`) that calls the same endpoints; native Google through `@better-auth/expo`'s browser-sheet flow. | Builds on what orrn already uses: one account table, one guard, one audit trail. Native passkeys need the domain-association files and Apple/Android app ids. |
| B | Let modrator's Authentik (auth.modrator.com) do passkeys and Google and sign people in to orrn over OIDC. | orrn sign-in would depend on the modrator VPS, and orrn is sold to other plants. Ruled out. |
| C | A, with the native Google account picker SDK on the phone. | Slightly smoother on the phone; adds the Google SDK and another client id. Can be added later without rework. |

The owner picked the how by handing it over ("work on the other things"): A.

## Design

### Server (`packages/auth`, `packages/server`, `packages/db`)

1. **Passkey plugin.** Add `@better-auth/passkey` (match 1.6.9). Config from the environment:
   - `rpID`: host of the web URL for the stage (`orrn.in`, `dev.orrn.app`, `localhost`).
   - `rpName`: "ORRN".
   - `origin`: the stage's web origin, plus, in production, the Android app origin (`android:apk-key-hash:<hash>`)
     when that value is configured. Unconfigured native values leave web passkeys working.
   - Discoverable credentials (resident keys) required, user verification preferred, so sign-in needs no email.
2. **Migration 0050** for the plugin's `passkey` table (Drizzle schema in `schema/auth.ts`), generated the repo's way.
3. **Google provider.** `socialProviders.google` with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` bound like the other
   secrets in `alchemy.run.ts` (secret encrypted; both or neither; the deploy log says present or not configured,
   never the value). Without them the Google button is hidden (a public config read tells clients what is on).
   Only verified Google emails are accepted.
4. **Google guard and onboarding** (new `google-guard.ts`, same style as `sign-up-guard.ts`). The owner's words:
   "if their email is already in the invite list and they login with google then they should be able to onboard".
   - **Create:** an account may be created through Google only when the email has at least one live invite
     (any company, member or portal kind). Otherwise no user row is written and the callback ends at the web
     `/login?error=GOOGLE_NOT_INVITED` (trusted origin; native gets the same code back).
   - **Accept on create (my call, from the owner's words):** when Google creates the account, every live invite for
     that email is accepted in the same step, through the same function `invite.acceptByToken` uses (refactored into
     one shared `acceptInvite` so member/portal branching, the "never staff and party login in one plant" refusal and
     the `member.invite.accept` audit row stay identical). This works from the login page, the invite page and the
     native screens; the person lands on their plant (or the plant switcher when there are several).
   - **Existing account, email already proven** (`emailVerified: true`): Google is linked; password and sessions stay.
     Live invites for that email are not auto-accepted here; the invite page accepts them as today.
   - **Existing account, email never proven** (`emailVerified: false`, for example an invite sign-up whose link the
     admin also saw): Google is linked, and because Google just proved the mailbox, the old password is removed and
     every other session for that user is ended, the same way a finished password reset ends sessions (my call;
     closes the "admin set a password on someone else's address" hole). The person can set a new password later in
     Settings > Sign-in.
   - **Email proof:** any Google sign-in with a verified Google email sets `emailVerified: true`.
5. **Staff accounts (my call).** A Godseye staff account (has a platform role) may not sign in with Google; it uses a
   passkey or password + code. The guard refuses with `GOOGLE_NOT_FOR_STAFF`. Reason: those accounts can reach every
   plant. The owner can flip this.
6. **No code after passkey or Google.** Pinned by tests: a passkey sign-in and a Google sign-in on an account with
   two-factor on return a session without a two-factor challenge.
7. **Sign-in links never beat a stronger method (my call).** The magic-link guard and Godseye's owner sign-in
   (`magicLinkAllowed`, `ownerAccount`) treat "has a passkey" and "has Google" like "has a password": no link signs
   such an account in, and such an owner leaves Godseye's "waiting to sign in" list. Lost-device recovery is: another
   passkey, Google, or Forgot password (email works through Purelymail since 2026-11-02).
8. **`auth.me`** gains `user.hasPasskey` and `user.hasGoogle`, and a `signInMethods` read for the settings page.
   `needsPassword` becomes: must-change-password, or no password **and** no passkey **and** no Google.
9. **Second-factor rule.** The owner's welcome "two-factor" step is complete when `twoFactorEnabled || hasPasskey ||
   hasGoogle`. The step becomes "Secure your sign-in": add a passkey (first, when the device can) or set up an
   authenticator app.
10. **Audit.** `auth.passkey.add`, `auth.passkey.remove`, `auth.google.link` rows (user-level, no company), words in
    en, hi, gu. Never log credential ids, public keys or Google tokens.

### Web (`apps/web`)

- **Login page** (`sign-in-form.tsx`):
  1. "Sign in with a passkey" button on top when `PublicKeyCredential` exists in the browser. The email field also
     carries `autocomplete="username webauthn"` and starts conditional mediation where the browser supports it, so a
     saved passkey shows in autofill.
  2. "Continue with Google" when Google is configured.
  3. "Use email and password" below; on a device without passkeys this is the main form as it is today (no broken
     passkey button).
  4. Errors (`GOOGLE_NOT_INVITED`, `GOOGLE_NOT_FOR_STAFF`, passkey cancelled or not found) are inline and announced,
     like today's errors.
- **Invite page** (`invite.$token.tsx`): "Continue with Google" next to create-account and sign-in. The Google
  callback returns to the same invite page, which accepts the invite as it does after the other sign-ins.
- **Welcome step** "Secure your sign-in" (replaces the owner-only two-factor step's first screen): add a passkey,
  or set up the authenticator app as today. Non-owners get a skippable "Add a passkey for faster sign-in" prompt
  when their device can.
- **Settings > Sign-in** (new tab for every signed-in person, own account only): passkeys (name, added date, last
  used; add, rename, remove), Google (linked or not; link), password (set or change), authenticator app (on or off).
  Removing the last way in is refused. For an owner (any company), removing or turning off the last strong method
  (authenticator app, passkey, Google) so that only a password is left is refused too (my call): it would break the
  owner two-factor rule silently, because the welcome step does not come back after onboarding.

### Native (`apps/native`)

- **Sign-in screen** (`app/(auth)/sign-in.tsx`): "Sign in with a passkey" first when the device supports it
  (`react-native-passkey` reports support), then "Continue with Google" (browser sheet via `@better-auth/expo`,
  returns through `orrn://`), then email and password as today.
- **Invite screen** (`app/invite/[token].tsx`): Google next to the existing choices.
- **Settings**: add and list passkeys, same rules as web.
- **Shared floor phones (my call).** The native app already treats floor phones as shared (no "remember this device"
  for 2FA, the shared-phone sign-out). So on native: passkey **sign-in** is offered to everyone whose phone supports
  it; **adding** a passkey is never prompted automatically, sits in Settings, and asks "Is this your own phone?"
  first, with the explanation that anyone who can unlock the phone could use it. Owners and admins see the welcome
  prompt; floor roles do not. Google on native always opens an ephemeral browser session, so no Google login stays
  behind on a shared phone. Web keeps the welcome prompt for every role (personal computers are the norm there).
- **Domain association:** iOS entitlement `webcredentials:orrn.in` (config plugin), and the web app serves
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` with the Apple Team ID and the Android
  signing certificate SHA-256 as build-time values. Until those values exist the native passkey button stays hidden
  and Google + password work.

## Owner inputs needed (not blockers for the code)

1. A Google Cloud OAuth client (Web), redirect URIs `https://api.orrn.in/api/auth/callback/google` and the dev API
   equivalent; client id and secret go in GitHub secrets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. Apple Developer Team ID (for the iOS passkey association).
3. Android release signing certificate SHA-256 (for `assetlinks.json` and the Android origin).

## Left to the builder

- Exact plugin option names in `@better-auth/passkey` 1.6.x and whether `origin` takes a list; check the installed
  package, not memory.
- Whether `@simplewebauthn/server` (the plugin's dependency) runs on the Worker as is; if not, stop and report.
- Choice and version of the React Native passkey module compatible with Expo SDK 55 / RN 0.83, as a config plugin.
- Component layout, following DESIGN.md and the existing auth frame; words through the ux pass.
- Test placement following AGENTS.md "Testing rules".
