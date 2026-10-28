# orrn agent tools (MCP) — design spec

Date: 2026-10-14 · Status: draft for owner review · Builds on: `2026-10-03-orrn-plant-modules-design.md` (data model, P1–P20), architecture digest ADR-011 ("AI stays out of the floor loop"), `AGENTS.md` (tenant isolation, roles, approvals, ledger), `packages/server/src/lib/permissions.ts`.

## 1. Intent

Fourcubes staff live on WhatsApp. They want to ask "how much 12170 is in the yard", "what is KD's baki", "where did bundle 26I4086 go" without opening the app. Several agent runtimes could answer: NanoClaw, Hermes, a Claude Agent SDK bot, Claude Managed Agents. None of them should be the asset. **The asset is the tool contract.** That contract is one MCP server, `orrn-mcp`, and any runtime can call it. It exposes plant data under the same identity, permissions, tenant scope and audit as the orrn UI.

Rules this spec adds to ADR-011:

- **A1. One contract, swappable runtime.** orrn never imports runtime code and stores no runtime state beyond the client registry (§4.2). Changing runtimes means pointing a new client at the same MCP URL.
- **A2. Reads are live. Writes are drafts.** No tool changes plant state. A write tool stores an `agent_draft`. A person confirms it in the orrn UI (web or native), and the real mutation then runs under that person's session (§3).
- **A3. The agent acts as a person.** Every call resolves to one orrn user in one company. It goes through `can()` and tenant scope, and from the Postgres rebuild onwards through RLS. The DB role is a non-owner role and never a superuser (§4).
- **A4. Everything is logged.** Every call is logged, including refused and failed ones (§5).
- **A5. Off the critical path.** If the agent, WhatsApp, the model provider or the internet is down, the plant loses no function (§7).

## 2. Tools (first 12, ranked)

They are ranked by how often the owner and floor staff would use them, judged from the paper forms, the order file and the dispatch chain (memory: operational truths, dispatch/PL chain). Tools 1–9 are reads and 10–12 are drafts.

### 2.1 Conventions (all tools)

- **No tenant or actor in inputs.** No tool accepts `companyId`, `userId` or a role. They come from the token (§4).
- **Human text in, resolved ids out.** Inputs take what people say: `"12170"`, `"12170-1"`, `"KD"`, `"K31"`, `"26I4086"`, a scanned QR URL, a legacy cuid. The server resolves them through aliases (`customer_alias`, `vendor_alias`, `legacy_bundle_map`, `resolve.byCode`). It never guesses. If a value matches more than one row, the tool returns `status: "ambiguous"` with up to 5 candidates, and the agent asks the user to choose.
- **Envelope.** Every result is `{ status, asOf, data?, candidates?, message? }`, where `status ∈ ok | ambiguous | not_found | forbidden | not_available | invalid | rate_limited`. `asOf` is the replica timestamp the answer reflects. `not_found` is generic and never reveals a row in another tenant. `not_available` means the module behind the tool is not built yet (sales orders, casts).
- **Units, as in `AGENTS.md`.** Weights are integer grams (`…G`). kg/12 ft is `…KgPer12ftMilli` (grams per 12 ft). Money is integer paise and appears only where §2.3 allows. Dates are company-local `YYYY-MM-DD` (IST), and ranges include both ends. Results also carry a `text` field preformatted in the caller's language (`en` / `hi`, later `gu`), so a runtime never has to do arithmetic on kg.
- **Lists.** `limit` defaults to 20, maximum 100, with `cursor` pagination. GROUP BY runs in SQL, and id lists are never bound.
- **MCP surface.** Each tool declares `inputSchema` and `outputSchema` and returns `structuredContent` plus a short text block. Reads carry `readOnlyHint: true`. Drafts carry `readOnlyHint: false`, `destructiveHint: false` and `idempotentHint: true` (keyed by `clientRequestId`). Tool descriptions include the plant's words (baki, oblique, kanta, PL, cast, finish AND/PVD) so any model maps the vocabulary.
- **Free text is data.** Notes, customer names and remarks come back marked `untrusted: true`, capped at 200 chars. They are never an instruction (prompt-injection boundary).

### 2.2 The tools

Types below are the contract, not implementation. `Ref` = `{ id: string; code: string; name?: string }`.

**1. `bundle_lookup`**: "what is this bundle, where is it, where did it go". Floor, office, owner.
```ts
in:  { code: string /* 26I4086 | J540 | BG-000001-B001 | cuid | https://…/b/… */; year?: number /* for month-only J540 */ }
out: { bundle: { number: string; section: Ref; oblique: string | null /* 12170-1 */; kgG: number; pcs: number;
         cutLengthMm: number; kgPer12ftMilli: number | null; weightRange12ftMilli: number | null /* floor((x+0.01)*10)/10 rule */;
         status: "available"|"reserved"|"dispatched"|"void"; location: Ref | null; cast: Ref | null;
         packedOn: string; orderLine?: { soNumber: string; line: number };
         dispatch?: { plNumber: string; customer: Ref | null; completedOn: string | null; invoiceNo: string | null };
         legacy?: { cuid: string; customerNote?: "not recorded before cutover" } } }
```
Customer and invoice fields appear only for callers holding `reports.read` or `dispatch.scan`. Pre-cutover sold bundles mostly have no customer (77,872 of 83,322 legacy `soldBundle` rows carry no usable reference), so the tool returns `customer: null` with the note rather than guessing.

**2. `stock_summary`**: "how much X is in stock". Owner, office, supervisor, packer.
```ts
in:  { section?: string; series?: string; location?: string; finish?: "none"|"anodise"|"pvd"|"6061";
       olderThanDays?: number; groupBy: "section"|"location"|"age_band"|"cut_length"|"finish" }
out: { rows: { key: Ref | string; bundles: number; kgG: number; pcs: number; oldestPackedOn: string;
               reservedKgG: number }[]; totals: { bundles: number; kgG: number } }
```
Bundles counted: `available` + `reserved`. Finish is an order-line attribute (P13), not a bundle attribute, so `finish` means "packed against an open order line with that finish". Free stock reports `finish: null`. See Q5.

**3. `order_book`**: "what is KD's baki, which orders are late". Owner, office.
```ts
in:  { customer?: string; section?: string; status?: ("booking"|"confirmed"|"dispatching"|"closed")[]; lateOnly?: boolean }
out: { lines: { soNumber: string; orderedOn: string; customer: Ref; section: Ref; finish: string | null;
                orderedKgG: number; producedKgG: number; dispatchedKgG: number; bakiKgG: number; bakiPcs: number;
                ageDays: number; late: boolean; ratePaisePerKg?: number }[]; totals: { bakiKgG: number } }
```
`not_available` until `sales_order` ships (P13). The meaning of "late" is open (Q6).

**4. `daily_report`**: the 7 am summary, on demand. Owner, manager.
```ts
in:  { date?: string /* default: yesterday */ }
out: { pressedKgG: number; recoveryBp: number | null; pressStops: { reason: string; minutes: number }[];
       bundlesPacked: number; packedKgG: number; trucksOut: number; dispatchedKgG: number;
       lateOrders: number; stockByYard: { location: Ref; kgG: number }[] }
```
This uses the same query as the Today screen and the scheduled 7 am push (§6.4). Fields whose module is not built yet return `null`.

**5. `dispatch_day`**: "what went out today, which trucks are still loading". Office, supervisor, owner.
```ts
in:  { date?: string /* default today */; status?: ("draft"|"reserved"|"completed"|"cancelled")[] }
out: { dispatches: { plNumber: string | null; customer: Ref; vehicleNo: string | null; status: string;
                     bundles: number; kgG: number; invoiceNo: string | null; completedAt: string | null }[];
       totals: { completed: number; kgG: number } }
```
The tool never returns the driver's phone.

**6. `die_status`**: "which copy of 12170 should run, how worn is it". Die room, press, supervisor, owner.
```ts
in:  { section: string /* 12170 or 12170-1 */ }
out: { section: Ref & { bandMinG: number; bandMaxG: number };
       copies: { oblique: string; tierRank: number | null; status: "in_use"|"available"|"at_nitriding"|"retired";
                 lastReading: { kgPer12ftMilli: number; on: string } | null; driftBp: number | null;
                 inBand: boolean | null; lastNitridedOn: string | null; pendingTierChange?: { toRank: number } }[];
       suggestion: { runFirst: string | null; why: string } }
```
Staff see the oblique code first and the tier second (oblique/tier memory). The suggestion is the P18 rule: the lightest copy that is within the band.

**7. `cast_trace`**: traceability both ways. Owner, supervisor, foundry; the customer side only with `reports.read`.
```ts
in:  { cast?: string /* K31 */; year?: number; bundle?: string }
out: { cast: { code: string; year: number; status: "open"|"closed" };
       upstream: { melts: number; inputs: { vendor: Ref | null; scrapItem: string; grade: string; kgG: number }[];
                   spectro: { attached: boolean; summary?: Record<string, number> } };
       downstream: { pressRuns: number; bundles: number; kgG: number; sections: Ref[];
                     customers?: { customer: Ref; bundles: number; kgG: number }[] } }
```
Cast codes repeat every year (J31 exists in 2024, 2025 and 2026). Without `year`, the tool returns `ambiguous` with one candidate per year, newest first. `not_available` until `cast` ships (P3).

**8. `customer_summary`**: "how is KD doing this year". Owner, office, accountant. This wraps `analytics.customerSummary`.
```ts
in:  { customer: string; from?: string; to?: string }
out: { customer: Ref; dispatchedKgG: number; previousPeriodKgG: number; dispatches: number;
       lastDispatchOn: string | null; openBakiKgG: number | null; rank: number | null }
```

**9. `my_pending`**: "what is waiting for me", covering approvals the caller can decide plus the caller's own agent drafts and their outcomes.
```ts
in:  { }
out: { approvals: { kind: string; number: string; requestedBy: string; ageHours: number }[];
       drafts: { id: string; kind: string; summary: string; status: "pending"|"confirmed"|"rejected"|"expired"|"failed";
                 resultRef?: string }[] }
```
Approvals reuse `approval.list` and its meta stripping (no weights or money in `meta`). The tool can list approvals but never decide them.

**10. `draft_sales_order`**: "KD Extrusion, 500 kg 12170 anodise, 16 ft". Office, owner.
```ts
in:  { clientRequestId: string; customer: string; poNumber?: string;
       lines: { section: string; kgG: number; pcs?: number; cutLengthMm?: number; finish?: string; kgPer12ftMilli?: number }[];
       note?: string }
out: { draftId: string; summary: string; confirmUrl: string; expiresAt: string }
```

**11. `draft_die_reading`**: "12170-1 is pulling 1.82 per 12 ft". Press, die room, supervisor.
```ts
in:  { clientRequestId: string; oblique: string; kgPer12ftMilli: number; readAt?: string; pressRun?: string }
out: { draftId: string; summary: string; driftBp: number | null; inBand: boolean; confirmUrl: string; expiresAt: string }
```

**12. `draft_invoice_link`**: "PL 41 went on invoice 269". Office.
```ts
in:  { clientRequestId: string; pl: string; invoiceNo: string; invoiceDate: string }
out: { draftId: string; summary: string; plKgG: number; confirmUrl: string; expiresAt: string }
```

Deliberately left out of v1: voiding, completing a dispatch, stock moves, counts, printing labels, publishing masters, deciding approvals, and anything under `users.*`, `export.*`, `spool.*` or `platform.*`. These are either floor-loop actions done by scanning or decisions that need a person looking at the screen.

### 2.3 Tool → permission map

Each tool declares `requires` (any-of). The server checks it with `can()` on the caller's membership, then intersects the result with the token's scope ceiling (§4.3). Today any member can call the web read routers (`companyProcedure`). The agent channel is deliberately **narrower**.

| Tool | requires (any of) | Field gates |
|---|---|---|
| bundle_lookup | any membership | customer/invoice: `reports.read` ∨ `dispatch.scan` |
| stock_summary | `reports.read` ∨ `stock.move` ∨ `stock.count` | — |
| order_book | `order.manage` ∨ `reports.read` | rate: `order.manage` ∨ `analytics.view` |
| daily_report | `reports.read` | — |
| dispatch_day | `reports.read` ∨ `dispatch.scan` | — |
| die_status | `die.reading` ∨ `die.card` ∨ `die.rerank` ∨ `reports.read` | — |
| cast_trace | `cast.enter` ∨ `cast.close` ∨ `reports.read` | customers: `reports.read` |
| customer_summary | `analytics.view` | — |
| my_pending | any membership | approvals filtered by `canApprove` |
| draft_sales_order | `order.manage` | — |
| draft_die_reading | `die.reading` | — |
| draft_invoice_link | `invoice.link` | — |

New action keys, added to `PLANT_ACTIONS` in `permissions.ts` (not invented client-side):

- `agent.link`: link your own WhatsApp or agent client. Default holders: owner, admin, manager, office, supervisor (see Q1).
- `agent.manage`: register agent clients, see the agent activity log for the whole plant, revoke links. Default holders: owner, admin.

## 3. Read vs write

**Reads** run against the cloud replica (ADR-011), never against the plant box, and are idempotent. Each read answers through the same service function as the web router, so tenant scope and joins match `AGENTS.md` exactly (for example the dispatch ⟕ item ⟕ bundle analytics rule). The MCP module contains no SQL of its own.

**Writes are drafts.** A draft tool:

1. validates the input against the **same zod schema** as the real mutation (`dieInstance.addReading` exists today; the sales-order create (P13) and the dispatch invoice-number update (P12) are planned and do not exist yet, so tools 10 and 12 wait for them);
2. checks `can(caller, action)` and resolves masters, returning `ambiguous`/`invalid` on failure;
3. inserts exactly one `agent_draft` row plus one `audit_log` row (`agent.draft.create`). It does not take a document number, write a ledger row, open an approval or print anything. There is therefore nothing to reverse.

```
agent_draft
  id uuidv7 · company_id · kind (sales_order | die_reading | invoice_link) · payload jsonb (validated input)
  summary text (what the person will be asked to confirm, in their language)
  requested_by → user · agent_client_id · grant_id · channel (whatsapp | mcp)
  client_request_id (unique per company) · status (pending | confirmed | rejected | expired | failed)
  expires_at (default +48 h) · decided_by → user · decided_at · result_ref (created document id) · failure text
```

**Confirmation happens only in the orrn UI.** Pending drafts appear on Today and under `/approvals` → "From the assistant". Each one opens the normal form (order, die reading, dispatch) prefilled from `payload` and editable. **Confirm** submits the real mutation under the confirmer's own session, with `clientRequestId = draft.id`, so a double tap replays rather than duplicates. The real mutation re-checks every rule: `can()`, balances, the D/C tolerance, the one-pending-approval-per-subject rule. If it opens an approval kind (a tier change opens `die_rerank`), that second-person rule still applies afterwards. The `agent_draft` row is then updated to `confirmed`, with `result_ref` set to the created document. Of all the tables the agent path touches, this is the only one where a row ever changes after insert, and only from the UI path.

Who can confirm: any user who holds the draft's action, including the requester. Confirming a draft is a "yes, that is what I meant" check. It is not a second-person approval, which stays the job of `approval` rows. Q3 asks whether the owner wants this stricter.

**Never through chat.** Replying "yes" on WhatsApp does not confirm a draft. The link in `confirmUrl` opens the app, which needs a real session. A stolen or shared phone can therefore read (within the scope ceiling) but cannot change anything.

## 4. Identity

### 4.1 Principle

An agent caller is never a service account with its own rights. Each MCP request carries a token that names **one user, one company, one agent client and one grant**. From the token the server builds the same `Context` a web request gets: `session.user`, `companyId` from the membership, never from input. Each request also gets `ctx.agent = { clientId, grantId, channel }`. Membership and company status are re-checked on every call, so removing someone from the plant cuts off their agent immediately. Agent tokens can never carry `x-orrn-company` or `x-orrn-impersonate-company`, and platform staff cannot use agent tokens.

### 4.2 Tables

```
agent_client   id · company_id · name ("WhatsApp bot", "Ansh – Claude Desktop") · kind (whatsapp_gateway | mcp_oauth | managed_agent)
               scope_ceiling text[] (tool names) · secret_hash (gateway only) · status (active | revoked) · created_by
agent_grant    id · company_id · user_id · agent_client_id · scopes text[] · created_at · expires_at · revoked_at · last_used_at
user_phone     id · company_id · user_id · e164 · wa_id · verified_at · verified_by (self | admin) · revoked_at
               unique (company_id, e164) where revoked_at is null
agent_call     see §5
```

All of them carry `company_id`, have composite tenant indexes and are covered by RLS like every other table.

### 4.3 Effective permission

`allowed(tool) = tool.requires ∩ can(user's role in company) ∩ grant.scopes ∩ client.scope_ceiling ∩ channel ceiling`

The channel ceiling for WhatsApp is reads plus drafts, with money fields off unless the owner turns them on (Q2). A `forbidden` answer names the missing action ("you need *order.manage*"), so the agent can tell the person whom to ask.

### 4.4 Tokens per client kind

- **Interactive MCP clients** (Claude Desktop/Code, Managed Agents connectors) use MCP's OAuth 2.1 authorization flow against orrn's auth server. The user signs in to orrn, picks the plant and approves the scopes, and orrn records an `agent_grant`. Access tokens last 15 min and refresh tokens 30 days, both revocable.
- **The WhatsApp gateway** (§6) authenticates as an `agent_client` using its secret. For each inbound message it mints a **per-message token** (5 min) for the grant of the user resolved from the phone number. The runtime gets that token and nothing broader, so it cannot act for anyone except the person who wrote.

### 4.5 Database role (Postgres rebuild)

The MCP module connects as `orrn_agent`, a login role that is not the table owner and has `NOBYPASSRLS`. Its grants:

- `SELECT` on the tables and views the read tools use;
- `INSERT` on `agent_draft`, `agent_call` and `audit_log`;
- **nothing else**: no `UPDATE`, no `DELETE`, and no `INSERT` on `stock_ledger`, `bundle`, `dispatch` or `doc_series`.

Every transaction runs `SET LOCAL app.company_id`, `app.user_id` and `app.via = 'agent'`, and RLS policies are `ENABLE` + `FORCE`. Even a bug in the MCP module therefore cannot touch stock. The confirm path runs in the normal app with role `orrn_app`. A CI check fails if `orrn_agent` gains a privilege beyond this list, alongside the existing "table without RLS" check.

**On the D1 stopgap** there is no RLS and no role split. The guarantee there is code-level only: a grep test, in the style of `plant-ledger.test.ts`, fails the build if the MCP module imports any mutation, `atomicBatch` or ledger builder other than the `agent_draft`/`agent_call` inserts. Recommendation: ship reads 1–9 on D1 if wanted, and drafts only after the Postgres move.

## 5. Audit

Every call writes one `agent_call` row. This includes refused calls, rate-limited calls and errors, because refusals are the signal.

```
agent_call  id uuidv7 · company_id · user_id · agent_client_id · grant_id · channel
            tool · input jsonb (redacted, ≤ 4 KB) · outcome (ok | ambiguous | not_found | forbidden | invalid | rate_limited | error)
            result_meta jsonb (row count, ids returned, draft id — never the full result)
            latency_ms · replica_lag_ms · request_id · conversation_ref (hash of the WhatsApp message id / MCP session id) · at
```

- **Append-only**, with the same rule as `stock_ledger`: never UPDATE or DELETE, a grep test enforces it, and retention follows `company.audit_retention_days`. No pruning cron is added (per `AGENTS.md`).
- **Redaction.** No tokens, OTPs, PINs, full phone numbers (last 4 only) or raw chat text. orrn records the structured tool input, and the conversation stays in the runtime.
- **The chain:** WhatsApp message → `agent_call` → `agent_draft` → `audit_log` (`agent.draft.create`) → on confirm, the real mutation's own `audit_log` row (actor = the confirmer, `meta.agentDraftId`) → ledger rows. You can walk from any ledger row back to the message that started it.
- **Owner view.** Settings → Assistant shows who asked what, per day, along with refusals and drafts confirmed or rejected, and has revoke buttons. It is gated by `agent.manage`.
- **Rate limits** are counted per user and per tool: reads 60/min and drafts 20/h by default. `bundle_lookup` gets a tighter sequential-number guard, because bundle numbers are sequential (see the warning about `resolve.publicBundle` in `AGENTS.md`).

## 6. WhatsApp front door

### 6.1 Shape

```
WhatsApp user ──► Meta Cloud API (plant's business number) ──► orrn wa-gateway (cloud)
                                                                  │ 1 verify X-Hub-Signature-256, dedupe message id
                                                                  │ 2 wa_id → user_phone → user + company (else stop)
                                                                  │ 3 mint 5-min token for that user's grant
                                                                  ▼
                                                        agent runtime (any) ──MCP──► orrn-mcp
                                                                  │ reply text
                                                                  ▼
                                                        wa-gateway sends the reply to the same 1:1 chat
```

The gateway belongs to orrn, not to the runtime, so changing runtimes does not touch phone identity. The runtime never receives the Meta credentials, and it never decides who the sender is. Identity is settled before the message reaches it.

### 6.2 Linking a phone to a user

Each path proves both who the person is and that they hold the phone.

- **Self-link (people who can sign in).** In orrn (web or native) → Settings → "Link WhatsApp", a 6-digit code is shown (valid 10 min). The person sends `LINK 123456` from their phone to the plant number. The gateway binds the sender's `wa_id` to that user and sets `verified_by = self`. Requires `agent.link`.
- **Admin-link (floor staff without a login, while PIN login is deferred, P11).** An admin (`users.manage` already covers "users, PINs, phones") enters the number. orrn sends a WhatsApp template carrying a code, the person reads it out to the admin in person, and the admin types it in. This sets `verified_by = admin`.

### 6.3 Limits

- Answers go only to the 1:1 chat of the person who asked. Group messages are ignored in v1, because one answer in a group would reach every member, including people without the role.
- An unknown number gets one fixed reply ("this number is not registered with Fourcubes; ask the office") and is logged. It is never forwarded to the agent. Customers and vendors are not served in v1 (Q7).
- Each number belongs to one user per company. A shared station phone is either refused or mapped to a limited station user (Q4).
- Unlinking is instant: the person can do it from Settings, and an admin can do it from Users. Removing a membership kills every grant. A link idles out after 90 days without use and must be re-linked.
- WhatsApp sender identity rests on the SIM. A swapped or lost SIM gives read access up to the channel ceiling and no write access, because drafts are confirmed in the app (§3). That is why money stays off on WhatsApp by default.
- Meta's 24-hour service window applies. Anything proactive outside it, such as the 7 am report or a "your draft was confirmed" note, uses pre-approved templates.

### 6.4 The 7 am report does not use the agent

The 7 am report is a scheduled job in orrn. It runs the same query as `daily_report` and fills a fixed template; there is no LLM call, so the number is deterministic. It goes to the recipients the owner picks (Q9). If WhatsApp is down, the same report is on the Today screen.

## 7. What stays out of the critical path

| If this is down | Plant impact | Why |
|---|---|---|
| Agent runtime / model provider | none | No floor action calls a tool. Pack, label, scan-to-PL, dispatch, count, press sheet, store and approvals are all in the orrn UI. |
| WhatsApp / Meta | none | Questions wait. The 7 am report is on the Today screen. |
| orrn-mcp / wa-gateway | none | They are separate deployments from the API that serves the UI, and they read from the replica. |
| Internet (plant side) | none for the floor (once the plant box exists) | The plant box is the system of record on the LAN (ADR-001). The agent layer is cloud-only, so it is simply unavailable. Until the plant box ships, orrn itself needs the internet. The agent adds no new dependency. |
| Replica lag | stale answers, labelled | Every answer carries `asOf`. Past 10 min of lag the tools return `text` with a "data as of 09:42" warning. |

Further guarantees:

- No document number, label, ledger row or approval decision is ever produced by the agent path.
- Drafts expire and nothing waits on them.
- A kill switch: the company setting `agents.enabled = false` (owner/admin) returns `not_available` from every tool and stops the gateway forwarding. Revoking an `agent_client` does the same for one runtime. Neither switch breaks anything else.
- Runtime hygiene, set in the runtime's config rather than in orrn: the WhatsApp runtime gets **only** the orrn MCP server. No web fetch, no shell, no other MCP servers. A prompt injection in a customer name then has nowhere to send data. Tool results are not kept beyond the conversation.
- Data leaving the plant: tool results go to the model provider of whichever runtime is in use. The owner decides once which fields may leave (Q2 money, Q8 customer names).

## 8. Legacy `fcms_db`

Agents never connect to `fcms_db`. It has no tenant, no roles and a single all-powerful `fcms` user. Legacy data reaches agents only after import into orrn:

- live bundles through `legacy_bundle_map`, so `bundle_lookup` accepts the cuid in old QR labels;
- sold history (83,322 rows) through `bundle.bulkImport`;
- cast strings (668 distinct values, year not encoded) are parsed into (year, month, seq) where they parse. Strays such as `B6396` or a lowercase `d` keep the raw text and `cast: null`, and `cast_trace` says so instead of matching them.
- Customer attribution before cutover is mostly missing, and the tools report it as missing.

## 9. Delivery order

1. **Reads on the current stack**: tools 1, 2, 5, 6, 9, plus `agent_client` / `agent_grant` / `agent_call`, OAuth for Claude Desktop, and the grep tests. Usable by Ansh and the owner from a desktop client.
2. **WhatsApp front door**: gateway, `user_phone`, the two link paths, the 7 am template. Reads only.
3. **Drafts**: `agent_draft`, tools 10–12, and the "From the assistant" inbox. Postgres only (§4.5).
4. **Modules as they land**: `order_book` with sales orders (P13), `cast_trace` with casts (P3), and `daily_report` filling in as press and QC ship.

Tests: a cross-tenant token sees nothing (the wired-tenant test pattern from `plant-analytics.test.ts`); every tool × every role matches §2.3; a refused call still writes `agent_call`; a draft writes no ledger, series or approval row; confirming twice replays; `orrn_agent` privilege CI check; an unknown phone never reaches the runtime.

## 10. Questions for the owner (to send on WhatsApp)

Each question has a default in brackets that the build takes until answered.

**Q1. Who may ask the WhatsApp assistant about plant data?**
(a) Only owner and Lalu uncle (b) Owner, Lalu uncle and the office (c) b plus supervisors (d) Everyone who has an orrn login
[c]

**Q2. Should the assistant show rates and money (₹/kg, order value) on WhatsApp?**
(a) Never on WhatsApp, only in the app (b) Only to the owner (c) Owner and office (d) Anyone who can see it in the app
[a]

**Q3. The assistant writes down an order from a WhatsApp message. Who must press "Confirm" in the app before it becomes a real order?**
(a) The same person who sent the message (b) Office or manager, never the sender (c) Only the owner
[a]

**Q4. Floor staff phones:**
(a) Everyone has their own phone with WhatsApp (b) Shared phone at each station (c) Mix of both (d) Floor staff will not use the assistant
[c → shared phones get no assistant access]

**Q5. Anodised / PVD material in the yard:**
(a) The yard holds only mill finish; finish is done after an order (b) Finished bundles also sit in the yard as stock (c) Finishing is job-work outside; material leaves and comes back
[a]

**Q6. When is an order "late"?**
(a) More than ___ days after booking (fixed number) (b) Each order has a promised date (c) No fixed rule; owner decides by looking
[b if the order file gets a date column, else a with 15 days]

**Q7. Should customers be able to message this number?**
(a) No, staff only (b) Later, to ask their own baki and dispatch status (c) Yes, from the start
[a]

**Q8. May customer names go to the AI service to answer questions like "what is KD's baki"?**
(a) Yes (b) Only the owner's questions (c) No; show codes and look the name up in the app
[a]

**Q9. Who gets the 7 am report on WhatsApp?**
(a) Owner only (b) Owner and Lalu uncle (c) b plus supervisors (d) b plus office
[b]

**Q10. Reply language:**
(a) Gujarati (b) Hindi (c) English (d) Same language the person wrote in
[d]

**Q11. A customer complains about a bundle. What do you look up first?**
(a) Bundle number from the label (b) Cast number (c) Die / section (d) PO or PL number
[a; this decides whether `cast_trace` or `bundle_lookup` gets more polish]

**Q12. A press operator sends "12170-1 reading 1.82" on WhatsApp. Is that acceptable?**
(a) Yes, the supervisor confirms it in the app (b) Yes, the operator confirms their own reading in the app (c) No, readings only on the press sheet
[a]
