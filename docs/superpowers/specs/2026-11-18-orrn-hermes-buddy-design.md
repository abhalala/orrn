# orrn buddy: Hermes in a floating chat, with orrn as its tools

Date: 2026-11-18 · Status: draft for owner review · Builds on: `2026-10-14-orrn-agent-tools-design.md` (tool contract rules A1–A5, audit, drafts), `fc/infra/agentbox/HERMES.md` (CT 230), `fc/infra/agentbox/utilities-ct232/UTILITIES.md` (the `models.orrn.in` gate pattern), `packages/server/src/index.ts` (procedure builders), `packages/server/src/lib/permissions.ts`.

## 1. Intent

The owner wants an assistant that lives inside orrn as a floating "buddy": a chat bubble on every screen that he texts with. The assistant can do anything in orrn that the owner can do, under his own permissions. Only owners get it for now. Later it opens to other users, each limited to their own role's permissions.

The brain is **Hermes** (the plant agent on vayu CT 230, model from CPA). The owner chose this over a separate orrn-only agent loop (2026-11-18, option B). The buddy is a window onto Hermes. The owner gets one agent with Hermes's memory and skills, inside the orrn screen. It is the same Hermes conversation store as Telegram (owner decision, §5).

Success: the owner opens orrn, taps the bubble, types "how much 12170 is in the yard" or "make an order for KD, 500 kg 12170", and gets an answer or a ready-to-confirm change without leaving the page.

## 2. Goals, non-goals, anti-goals

Goals
- G1. A floating chat bubble in the orrn web app, on every signed-in tenant screen, for users with role `owner`.
- G2. Hermes can call **all of orrn** (every tRPC procedure the caller's role allows), not a curated tool list.
- G3. Every orrn call Hermes makes runs as one named orrn user in one company and goes through the same middleware as the UI: session-equivalent identity, `companyProcedure`, `actionProcedure`/`can()`, module gate, tenant scope.
- G4. Changes (mutations) never run straight from the model. Hermes proposes; the person clicks Confirm in orrn; orrn runs the call under the person's own browser session.
- G5. Opening the buddy to other roles later is a config change (allowed roles + one Hermes profile per user), not a rewrite.

Non-goals (v1)
- Native app (iOS/Android) buddy. Web only.
- Plant screen (vayu kiosk) changes. It keeps its own Hermes workspace.
- Voice, file upload, images.
- WhatsApp front door from the October spec. It can reuse the same MCP endpoint later.

Anti-goals (failure even if it works)
- The model can change stock, orders or anything else without a human click.
- One orrn user's buddy acts with another orrn user's permissions. (Exception accepted by the owner, §5: the shared Hermes profile means everyone allowed on Hermes's Telegram reaches orrn with the owner's grant, read and draft only.)
- The buddy being down, slow or wrong breaks any orrn screen or floor action.
- A Cloudflare route or key that exposes Hermes's shell, Webapp, dashboard or CPA to the internet.

## 3. Approaches considered

| | What | Trade-off | Picked |
|---|---|---|---|
| A | orrn runs its own small agent loop on CPA (via the existing `models.orrn.in` gate). The same tool surface is also given to Hermes as MCP. | Works when vayu is down; no shell near untrusted text; per-user identity is natural. But the buddy and Hermes are two brains with separate memory. | No |
| **B** | The buddy is a chat window onto Hermes. orrn proxies the chat to Hermes's API server; Hermes calls orrn back through an MCP endpoint. | One brain with Hermes's memory, skills and conversation store. Hermes has a shell and prod rights, so prompt injection from orrn text has a bigger blast radius. Hermes treats all callers of one profile as one identity. Buddy is down when vayu or the tunnel is. | **Yes (owner, 2026-11-18)** |
| C | Embed the Hermes Webapp in an iframe | Gives the shell and terminal rail to anyone with the page; the Webapp has no per-user permissions and its sign-in fights orrn's. | No |

## 4. Shape

```
orrn web (owner signed in)
  floating bubble ──POST /buddy/chat (session cookie, SSE back)──► orrn Worker
                                                                    │ 1 session + membership + role ∈ BUDDY_ROLES
                                                                    │ 2 pick the user's Hermes profile
                                                                    ▼
                         https://hermes.orrn.in  (fourcubes-plant tunnel, CT 231)
                         Cloudflare Access: service token held only by the orrn Worker
                         nginx: only POST /p/<profile>/v1/chat/completions (or /v1/responses)
                                                                    ▼
                                         CT 230 Hermes API server :8642, profile per user
                                                                    │ agent turn (CPA model, Hermes tools)
                                                                    │ MCP over streamable HTTP, bearer = that profile's orrn grant
                                                                    ▼
                                         https://api.orrn.in/mcp  (orrn Worker)
                                           token → user + company → ctx → appRouter.createCaller(ctx)
                                           queries run; mutations become a buddy_draft
                                                                    ▼
  bubble shows the draft card ──"Confirm" (normal tRPC call, owner's own session)──► orrn runs the real mutation
```

### 4.1 Chat leg (orrn → Hermes)

- New Worker route `POST /buddy/chat` (Hono, beside the tRPC handler). It builds the normal `Context` from the request, then requires: a session, an active membership, `role ∈ BUDDY_ROLES` (v1: `["owner"]`, a constant in `permissions.ts` next to a new plant action `buddy.use` whose only holder is `owner`), and the buddy configured on this stage (§6). Otherwise 403 / 404, no body detail.
- The Worker forwards the conversation to Hermes's OpenAI-compatible API server at `HERMES_BASE_URL` + `/p/<profile>/v1/...`, with the Access service-token pair and that profile's `API_SERVER_KEY`. It streams Hermes's SSE back to the browser unchanged except for stripping anything that is not assistant text, tool-progress or a finish event.
- Profile choice: a table `buddy_link (company_id, user_id, hermes_profile, status, created_at, revoked_at)`. v1 has one row: the owner in `fourcubesllp` → the default profile (no `/p/<profile>` prefix). The Worker never takes a profile from the browser.
- What the Worker sends with each turn (as a system/context block, not as user text): the user's display name, company name, role, today's date in company time, the current screen path. It never sends tokens.
- Conversation memory lives in Hermes (its session store). orrn stores no chat text (October spec §5 rule: the conversation stays in the runtime). The bubble keeps the current conversation id in `sessionStorage` and offers "New chat". Builder verifies which Hermes endpoint keeps server-side sessions (`/v1/responses` with a conversation/previous id, or `/v1/runs`) and uses that; plain stateless `/v1/chat/completions` with the browser resending history is the fallback.
- Timeouts: one turn may take minutes (Hermes tool loops). The Worker streams, so no single response waits; nginx `proxy_read_timeout` 300 s and `proxy_buffering off`, like `models-gate.conf`.

### 4.2 Tool leg (Hermes → orrn MCP)

- New Worker route `/mcp`: an MCP server (streamable HTTP transport) generated from `appRouter`.
- **Tool surface: three meta-tools, not one tool per procedure.** There are ~40 routers and several hundred procedures; listing each as a tool would flood the model's context.
  - `orrn_search({ query })` → procedures whose path, description or input field names match, each with `path`, `kind: query|mutation`, a one-line description, and whether the caller's role can call it.
  - `orrn_describe({ path })` → the input JSON Schema (zod v4 `z.toJSONSchema` of the procedure's input parser), the description, the required action(s) when known.
  - `orrn_call({ path, input })` → runs a **query** through `appRouter.createCaller(ctx)` and returns the result (trimmed, see below). For a **mutation** it does not run it: it validates `input` against the procedure's zod parser, checks `can()` up front where the action is known, inserts a `buddy_draft` row and returns `{ status: "needs_confirm", draftId, summary }`.
- A registry module builds the catalogue once per isolate by walking `appRouter._def.procedures` (type, path, input parser). Descriptions come from a hand-kept map `buddyDescriptions` (path → one line in plant words) with a fallback built from the path; missing descriptions are a lint warning, not a failure.
- **Denylist (never a tool, query or mutation):** `auth.*`, `invite.*`, `platform.*`, `portal.*`, `waitlist.*`, `spool.*` (secrets, tunnels), `edge.*`, `device.*`, `release.*`, `backup.*`, `support.*`, `ingest.*` (owner runs imports in its own screen), `healthCheck`, `privateData`, and every procedure that changes members, roles, PINs or company settings (`company.updateSettings`, member/role procedures). The list lives in one constant with a test that fails if a new router appears without a decision (allow or deny).
- Results: JSON, capped (e.g. 32 KB; longer results are cut with a `truncated: true` flag and a hint to narrow the query). Free-text fields are data, not instructions; the MCP tool descriptions say so (October spec §2.1 "Free text is data").
- Errors map to the October envelope `status` values: `forbidden` (names the missing action), `not_found`, `invalid` (zod issues), `rate_limited`, `error`.

### 4.3 Identity on the tool leg

- Hermes holds no orrn session. Each Hermes profile's MCP config carries one bearer token: an **orrn buddy grant** for one (user, company).
- Table `buddy_grant (id, company_id, user_id, token_hash, scopes, created_by, created_at, expires_at, revoked_at, last_used_at)`. Token = random 32 bytes, shown once at creation, stored hashed (SHA-256). v1: created by the owner from Settings → Buddy ("Connect Hermes"), copied into CT 230 by the lead via the usual secret-file path, never printed.
- On every MCP request the Worker resolves token → grant → user + company, re-checks the membership is active, the role still holds `buddy.use`, the company is active, the grant is not revoked or expired. It then builds the same `Context` shape a web request gets (`session.user`, `companyId`, `membership`, `role`) with `ctx.via = "buddy"` and `ctx.impersonation = null`. Platform staff and impersonation never apply.
- From there every query is the normal tRPC path: the middleware stack, `can()`, module gate and tenant scope are the same as the UI's.
- `buddy_grant` and the Access token pair are the two locks. Revoking the grant (Settings → Buddy) cuts Hermes off immediately; removing the person's membership does too.

### 4.4 Confirm-first writes

- `buddy_draft (id, company_id, requested_by_user_id, grant_id, path, input_json, summary, status pending|confirmed|rejected|expired|failed, created_at, expires_at (+24 h), decided_by, decided_at, result_json, failure)`.
- Creating a draft writes nothing else: no document number, ledger row, approval or print (October spec §3).
- The bubble polls `buddy.drafts.listMine` (and refreshes after each turn) and renders each pending draft as a card: the procedure in words, the input as a readable list, **Confirm** and **Reject**.
- **Confirm** is a normal tRPC mutation `buddy.drafts.confirm({ draftId })` from the browser, under the person's own session. It re-reads the draft, checks it belongs to this user and company and is pending and unexpired, then runs `appRouter.createCaller(ctxOfThisRequest)[path](input)`. So the real mutation re-checks every rule (`can()`, balances, approvals, module gate) as that person. The draft becomes `confirmed` with the result, or `failed` with the error message. A second confirm of the same draft returns the stored result.
- Only the browser session can confirm. The MCP token cannot call `buddy.*` (denylisted on the tool leg), so Hermes cannot confirm its own drafts.
- After a confirm the bubble sends Hermes a short system note ("draft X confirmed: <result summary>") on the next turn, so the conversation knows.

### 4.5 The floating bubble (web)

- Mounted once in the `_tenant` layout, rendered only when `me.company.role` can `buddy.use` and `auth.me` says the buddy is available on this stage.
- Closed: a round button bottom-right (above the command palette and toasts, clear of the mobile bottom nav). Open: a panel about 400 × 600 px on desktop, full-screen sheet on phones. Header: "Buddy", New chat, close. Body: messages, a small "used orrn: stock.summary" chip per tool call, draft cards. Footer: one text box, Enter sends, Shift+Enter new line.
- States: connecting, streaming, "Buddy is offline" (Hermes or tunnel unreachable: one line, no retry storm), error per message with Retry.
- Theme: orrn C2 tokens and `@orrn/ui` components; strings in `packages/i18n` (en, hi).
- The panel stays open across route changes (state in a React context at layout level).

## 5. Hermes side (CT 230)

- Enable the API server on loopback: `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, port 8642, with per-profile routing `/p/<profile>/v1`.
- **Profile: Hermes's default profile (owner decision 2026-11-18).** The buddy shares Hermes's memory, skills and session store with Telegram and the Webapp. The default profile's MCP config gets the owner's orrn grant (`mcp_servers.orrn: { url: https://<api host>/mcp, headers: Authorization: Bearer <grant> }`).
  - Consequence the owner accepted: Hermes treats every allowed caller of a profile as one identity (its SECURITY.md), so everyone on Hermes's Telegram (owner, Dad, Lalu, all orrn owners of fourcubesllp today) can read orrn and create drafts with the owner's grant. They cannot change anything: a draft runs only when someone clicks Confirm in the orrn bubble under their own orrn session (§4.4), and the MCP token cannot confirm.
  - `buddy_call` rows record the Hermes platform (api_server vs telegram) when Hermes passes it, so the owner can see which side asked.
  - Per-user grants (one Hermes profile or gateway per person) stay the path for opening the buddy to other roles (G5); a later owner decision.
- **Toolsets on the buddy's platform (owner decision 2026-11-18): orrn + memory + web only.** `platform_toolsets.api_server` = the orrn MCP server, memory, session search, skills (read), web search/extract, todo. No terminal, process, file write, code execution, browser, cron or delegate tools on API-server sessions, because orrn data (customer names, notes) flows into these turns and CT 230 holds GitHub, Cloudflare and prod credentials. Telegram and the Webapp keep their current full toolset. Builder verifies on v0.23.1 that `platform_toolsets.api_server` is honoured exactly (`/tools list` through the API) and that plugin toolsets are not added on top. `approvals.unattended_mode: deny` stays on.
- The profile's model comes from CPA, as for every Hermes profile.
- Skills: a small `orrn-buddy` skill (plant vocabulary, "search → describe → call", "mutations come back as drafts; tell the person to confirm in the card", units: grams, paise, IST).
- Network: CT 231 nginx gets a second gate file `hermes-gate.conf` (pattern of `models-gate.conf`): host `hermes.orrn.in`, requires the Access JWT header, passes only `POST /p/<profile>/v1/<chat endpoint>` to `192.168.230.2:8642`; everything else 404. The fence (`vayu-guard`) gains one accept: CT 231 → CT 230 tcp 8642. CT 230 needs outbound 443 to the orrn API host for MCP (it already reaches Cloudflare over 443).
- Cloudflare: tunnel ingress `hermes.orrn.in` on `fourcubes-plant`; Access app "orrn buddy gate" with a service-token-only policy (token "orrn buddy (hermes.orrn.in)", one year).

## 6. Configuration on the orrn side

Worker env (GitHub environments `dev` and `production`, passed through turbo and alchemy like the `ANTHROPIC_*` names were in PR #9):
- `HERMES_BASE_URL` (origin only), `HERMES_ACCESS_CLIENT_ID`, `HERMES_ACCESS_CLIENT_SECRET`, `HERMES_API_KEY` (v1: one key; per-profile keys later live in `buddy_link`, encrypted with the existing crypto package).
- All four set → buddy available; any missing → `auth.me.buddy = false`, bubble hidden, `/buddy/chat` 404. Same "both or neither" checks as `resolveShapeConfig`, and log variable names only, never values.
- Dev stage may point at the same Hermes profile or none; e2e tests use a fake Hermes (a stub SSE server) and never the network.

## 7. Audit and limits

- Every MCP call writes one `buddy_call` row (append-only): company, user, grant, tool, path, outcome, ms, result size. No result bodies, no chat text (October spec §5).
- Draft create, confirm, reject and fail write `audit_log` rows; the real mutation's own audit row carries `meta.buddyDraftId`.
- Rate limits per grant: 60 tool calls/min, 20 drafts/hour, 30 chat turns/hour.
- Settings → Buddy (owner only): connect/revoke Hermes grant, last-used time, the last 100 `buddy_call` rows, pending/decided drafts.
- Kill switch: revoke the grant, or unset `HERMES_BASE_URL`, or disable the Access token. None breaks anything else.

## 8. What stays out of the critical path

The buddy is a separate Worker route plus a lazy-loaded web chunk. If Hermes, CPA, vayu or the tunnel is down, the bubble says "Buddy is offline" and every other screen works. No floor action depends on it.

## 9. Delivery order

1. orrn: registry + denylist + MCP endpoint (`orrn_search`, `orrn_describe`, `orrn_call` for queries) + `buddy_grant` + `buddy_call`, with tests (cross-tenant token sees nothing; a viewer-role grant gets `forbidden` on an owner-only query; denylisted paths are not found; every router has an allow/deny decision).
2. orrn: drafts (`buddy_draft`, confirm/reject, the double-confirm replay test, the "MCP token cannot confirm" test).
3. orrn: `/buddy/chat` proxy + bubble UI + Settings → Buddy, against a fake Hermes.
4. vayu: API server, orrn MCP in the default profile, api_server toolset limits, `orrn-buddy` skill, gate + fence + tunnel + Access. Then a live test on dev with the owner.
5. Promote to prod only on the owner's say-so.

## 10. Calls made in this design (check these)

- **Drafts ship on D1, now.** The October spec deferred drafts to Postgres because a draft tool on D1 is protected only by a grep test. Here a draft row changes no plant data, and the confirm runs the ordinary tRPC mutation under the person's browser session, so its protection is the same as the UI's. Carried over from October: a grep test that the MCP module imports no mutation code, `atomicBatch` or ledger builder (only the `buddy_draft`/`buddy_call` inserts and the caller); the draft id is passed as `clientRequestId` wherever the target procedure takes one, and `buddy.drafts.confirm` replays a confirmed draft's stored result. Drafts show in the bubble and Settings → Buddy only, not on Today or `/approvals` in v1.
- **Queries run without a click.** "Entire orrn" includes every allowed query. Step 1 includes a one-time scan of all queries for any that write rows, take numbers, call outside services or return bulk exports; each hit is denylisted or routed through the draft path, and the allow/deny test pins the result.
- **Web only, owner role only, fourcubesllp only** for v1.
- **Buddy is down when vayu or the tunnel is down.** Accepted with option B.

## 11. Left to the builder

- Exact Hermes endpoint for server-side sessions and its streaming event shape (verify against v0.23.1 source on CT 230).
- The MCP server library that runs in Workers (official TypeScript SDK streamable HTTP, or a minimal hand-rolled JSON-RPC handler if the SDK needs Node APIs).
- Wording of descriptions and the skill; trimming rules for large results.
- Visual details of the bubble within the C2 system.

## 12. Import tools (owner decision 2026-11-20)

The owner was asked how importing by chat or voice should work and chose "Buddy import tools". The buddy helps
with an import. The person keeps the tick and the Approve. Voice comes later.

This section replaces the blanket `ingest.*` entry of the denylist in §4.2. Each ingest procedure now has its own
allow or deny decision.

### 12.1 What the buddy can do in an import

| The buddy can | Through | How it runs |
|---|---|---|
| List import files and their state | `ingest.status`, `ingest.artifact.list`, `ingest.artifact.get`, `ingest.candidate.list` | query, runs at once |
| Start reading a file that is already uploaded | `ingest.shape.make` (the layout read of a sheet). When release 2 lands: `ingest.vision.readPage` for a page whose image is already uploaded | draft, the person confirms |
| Answer the importer's questions | `ingest.answer.set`, `ingest.rows.answerDoubts`, `ingest.period.confirm`, `ingest.candidate.confirmNear`, `ingest.candidate.setTarget`, `ingest.candidate.hold`, `ingest.candidate.release` | draft, the person confirms |
| Show a candidate's fit and dry run results | `ingest.candidate.get`, `ingest.rows.list`, `ingest.rows.doubts`, `ingest.hole.list`, `ingest.merge.get`, `ingest.provenance.forRecord`; `ingest.dryRun.step` | queries at once; the dry run step is a draft |
| Hand the person the review page | the MCP tool `orrn_review_link` | builds a link to `/ingest/review/<candidateId>` or `/ingest/files/<artifactId>` on the plant's web host |

A draft from an import tool is an ordinary `buddy_draft` (§4.4). Confirm runs the procedure under the person's own
browser session, so `can()`, the module gate, the `expectSeq` check and the plant's model caps all apply as in the
import screen. A draft card for an import also carries the review link, so the person can open the page before they
confirm.

### 12.2 File upload stays in the browser

The bubble has an "Add a file" button. It opens the normal import upload (`/ingest`). File bytes never go to Hermes,
vayu or the MCP endpoint. The upload procedures are denylisted on the tool leg.

### 12.3 Never callable by the buddy, not even as a draft

| Path | Why |
|---|---|
| `ingest.vision.check` (lands with release 2) | It sets `model_checked`, "I checked these rows against the page". A Confirm in the bubble does not show the page image, so the tick would mean nothing. |
| `ingest.candidate.approve` | Approve stays a person's act on the review page. |
| `ingest.merge.start`, `ingest.merge.step`, `ingest.merge.stop` | The final write of an import. |
| `ingest.hole.retire` | A final change to what the merge left open. |
| `ingest.candidate.discard` | Discard of an artifact's table. |
| `ingest.artifact.begin`, `ingest.artifact.commitRaw`, `ingest.artifact.putBlocks`, `ingest.artifact.putRows`, `ingest.artifact.complete` | Upload. File bytes and parsed rows come from the browser only (§12.2). |
| `ingest.rows.decide`, `ingest.rows.skipNoDate` | Row by row keep or refuse is a check against the file, made on the review page. |
| `ingest.candidate.repickHeader`, `ingest.shape.save` | The person picks the header row and saves a layout while they see the sheet. |
| `ingest.vision.start`, `ingest.vision.bandTickets`, `ingest.vision.skipPage`, `ingest.vision.typePage`, `ingest.vision.fixCell`, `ingest.vision.readUrl` (release 2) | They need the page in the browser: the page count from the PDF, page images, or typing against the image. |

The ingest decisions live in the one allow/deny constant of §4.2. A test fails when an `ingest.*` procedure has no
decision, so a new procedure from release 2 or later cannot become a tool by accident. The release 2 paths are listed
ahead of the merge; the test accepts a listed path that does not exist yet only from that named list.

### 12.4 Caps

A model call the buddy starts through ingest (`ingest.shape.make`, later `ingest.vision.readPage`) runs only on
Confirm, under the person's session, through the same procedure. It counts against the same plant caps as a click on
the import screen. The per-plant limits set in Godseye (release 2) apply with no buddy-specific path.

### 12.5 The `orrn-buddy` skill

The skill text lives in the repo for now at `docs/hermes/skills/orrn-buddy/SKILL.md`. It explains the import flow to
Hermes in plain words: the steps, what needs a person, and to end every import answer with the review link. The lead
copies it into CT 230 in delivery step 4.

## 13. Build contract for delivery steps 1 to 3 (2026-11-20)

Fixed names, so the server and web lanes build at the same time.

- **Tables** (one migration, the next number after main): `buddy_link`, `buddy_grant`, `buddy_call`, `buddy_draft`
  as in §4.1, §4.3, §4.4 and §7. All carry `company_id`.
- **Which plants:** env `BUDDY_COMPANIES`, a comma list of company slugs (v1: `fourcubesllp`). "Connect Hermes"
  creates the `buddy_link` row (default profile) and the grant only for a listed plant.
- **Permission:** plant action `buddy.use`, held by `owner` only; `BUDDY_ROLES = ["owner"]`.
- **`auth.me.buddy: boolean`:** true when the four `HERMES_*` vars are set, the role can `buddy.use`, the plant is
  listed, and the person has an active `buddy_link` here.
- **tRPC `buddy` router (browser session only; denylisted on the tool leg):**
  - `buddy.status` query: `{ available, listed, connected: { grantId, createdAt, lastUsedAt, expiresAt } | null }`
  - `buddy.grant.create` mutation: `{ grantId, token }`, the token shown once
  - `buddy.grant.revoke` mutation `{ grantId }`
  - `buddy.calls.list` query: the last 100 `buddy_call` rows
  - `buddy.drafts.listMine` query: pending drafts and the last 20 decided, each
    `{ id, path, title, lines: { label, value }[], status, createdAt, expiresAt, result, failure, link }`
  - `buddy.drafts.confirm` `{ draftId }` and `buddy.drafts.reject` `{ draftId }`
- **Chat:** `POST /buddy/chat`, body `{ conversationId?: string, message: string, screen: string, notes?: string[] }`.
  The answer is SSE in orrn's own shape, whatever Hermes sends:
  `{"type":"text","delta":"..."}`, `{"type":"tool","path":"stock.summary"}`, `{"type":"draft","draftId":"..."}`,
  `{"type":"done","conversationId":"..."}`, `{"type":"error","code":"offline"|"rate_limited"|"error"}`.
  403 or 404 with no body detail when the person may not use it.
- **MCP:** `POST /mcp`, JSON-RPC 2.0 over streamable HTTP, bearer = grant token. Tools `orrn_search`,
  `orrn_describe`, `orrn_call`, `orrn_review_link`.
- **Fake Hermes:** `apps/server/scripts/fake-hermes.ts`, a Bun server that speaks the Hermes endpoint the proxy uses.
  Tests and e2e use it, never the network.
