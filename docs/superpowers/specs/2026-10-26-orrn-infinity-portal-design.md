# ORRN Infinity Portal (Universal AI Ingest & Artifact Vault) — design spec + agent handoff

Date: 2026-10-26 (updated 2026-10-27) · Status: **owner-set TOP PRIORITY** (recorded in `TODO.md`) · Companion spec: `2026-10-14-orrn-agent-tools-design.md` (agent tool contract, rules A1–A5)

> This file is the handoff for the next AI agent. It records (1) the plan, (2) the feature list,
> (3) the history of the chat that produced it, and (4) the constraints any build must respect.
> The owner calls this feature **the Infinity Portal** (also "input/injest portal"): something that
> makes sense out of everything a plant feeds it, from any era of the plant's past.

## 1. Why

ORRN's first plant (FourCubes) cut over to production on 2026-10-26, but the plant's **past** is
not in the system: FCMS SQL exports, Excel baki/die sheets, Tally dumps, WhatsApp order sheets,
PDF packing lists, photos of paper registers (cast books, die cards), CAD/PDF drawings. Today orrn
only has fixed-column client-side CSV/XLSX sheets (`import-sheet.tsx`) for dies, customers and
pre-cutover bundles (`legacy_bundle_map`), plus manual opening-balance screens
(`docs/OWNER_HANDOVER.md`). Everything else must be hand-cleaned or is not stored at all.

The owner wants one portal that:

1. accepts **any file + a free-text prompt** (e.g. *"this is our 2025–26 FCMS party baki workbook —
   import only open orders for KD and Sunrise, map 'Patti' to series PATTI, treat rate as Rs/kg"*),
2. preserves every file **forever** as a compressed, AI-indexed artifact,
3. **auto-detects which period in history** each artifact/output belongs to (owner, 2026-10-27:
   "auto figures out what time in history was the output from"),
4. **auto-merges** the same real-world entities across files (owner, 2026-10-27: "it also auto
   merges ... and stuff like that"), and
5. turns it all into **validated ERP records** without breaking ledger/audit/tenant invariants.

## 2. Feature list (what to build)

- **F1 Universal ingest.** `/ingest` screen: drop any file (XLSX, CSV, PDF, images, SQL dumps,
  JSON) plus an owner/admin free-text prompt. Signed PUT to R2 (same pattern as `dieFile.ts`,
  `backup.ts`). SHA-256 per tenant: re-uploading the same workbook never duplicates storage or
  double-imports.
- **F2 Artifact Vault.** Per file, in R2 under `tenants/<companyId>/artifacts/<year>/<sha256>`:
  (a) `raw.<ext>.zst` — lossless compressed original, kept forever for compliance/audit;
  (b) `digest.md` + `canonical.jsonl` — the **AI-compressed artifact**: empty cells, repeated
  headers, formatting noise and OCR boilerplate stripped, dense structured tables + semantic
  summary (~70–85% smaller than the raw file), so future AI queries and audits read the history
  in a fraction of the tokens. D1 `ingest_artifact` registry row: id, companyId, sha256,
  originalName, mimeType, rawBytes, compressedBytes, userPrompt, aiSummary, detectedDomains,
  **detectedPeriod / asOf** (F7), status, createdBy, createdAt.
- **F3 Prompt-guided extraction.** Deterministic pre-pass parses sheets/CSV/JSON into row
  batches; PDFs and register photos go through multimodal vision/OCR. A structured-LLM pass
  (strict JSON/schema output) maps columns into typed Zod target schemas covering every
  historical gap: masters & aliases (customers + `customer_alias`, vendors + `vendor_alias`,
  transporters, locations, reason codes), die room history (sections, `die_instance` obliques,
  tiers, nitriding, drawings), stock & pre-cutover bundles (+ `legacy_bundle_map` + opening
  ledger entries), the open order book (baki, with already-produced/dispatched weights so
  remaining baki is exact on day one), foundry & cast continuity (`legacy_code` from migration
  0042, return-stream openings, purchase lots), historical dispatches/PLs (pre-cutover rows with
  missing customers stay explicitly flagged, never guessed — 77,872 of 83,322 legacy sold bundles
  carry no usable customer reference).
- **F4 Entity resolution + dry-run staging.** Every extracted row runs through orrn's resolvers
  (`resolve.byCode`, die keys, customer/vendor aliases, `legacy_bundle_map`) and domain guards
  (integer grams, integer paise, `kgPer12ftMilli`, band checks). Rows are staged in
  `ingest_batch`/`ingest_row` as `ready_create` | `ready_update` (field diff) | `ambiguous`
  (the UI asks once, and can save an alias/mapping rule for the rest of the batch) | `refused`
  (with the exact rule that refused it). **The AI never writes directly to live ERP tables.**
- **F5 Human review & idempotent commit.** Diff/ambiguity review UI; on Approve, rows execute in
  topological dependency order (masters → dies → casts/openings → bundles/legacy map → orders →
  dispatches/PLs) through the **existing domain mutations**, keyed
  `clientRequestId = sha256(artifactId + rowIndex)` so a double tap replays instead of
  duplicating. Every audit row records `sourceArtifactId` + `sourceRow`: anyone inspecting a
  bundle/cast/die/order years later can click back to the exact historical file and row.
- **F6 Auto-merge (owner requirement, 2026-10-27).** The same real-world entity arrives many
  times across files and eras (KD in the FCMS sheet, "KD Extrusion" on a WhatsApp order, "K D
  Alu." in a Tally dump). The portal reconciles across artifacts: canonicalizes, clusters against
  existing masters, learns/saves aliases, and **surfaces field-level conflicts instead of silent
  overwrite** (keep both values with provenance when uncertain; the review UI decides). Repeated
  SHA-256 blocks re-import; near-duplicate detection (same entity, overlapping period) is part
  of the same pass.
- **F7 Temporal attribution (owner requirement, 2026-10-27).** "Auto figures out what time in
  history was the output from." Each artifact and row gets a detected period: filename cues
  ("2025-26 baki"), header years, cast-code year (cast codes repeat every year), date columns,
  bundle-number era (legacy `BG-` vs plant `26I…` numbering, migration/series rules),
  sequence context, cross-sheet totals. Store `detectedPeriod` (FY or month) + confidence on the
  artifact and per-row `asOf`; history layers in chronological order so openings, baki and
  dispatches land on the right timeline; every digest/answer states the period it reflects
  ("data as of Mar 2026"). Ambiguous eras are surfaced like any other ambiguity — never guessed.
- **F8 Hybrid model routing.** Never one big model for everything:
  - deterministic parsers do the math (the LLM writes the mapping spec; Bun runs the rows —
    integer grams/paise never come out of an LLM's floating point);
  - a cheap/fast classifier pass inspects `{fileName, sheetNames, headers, sampleRows, userPrompt}`
    and picks the target schema(s), pruning 75–85% of prompt bloat, triaging row-level
    exceptions in parallel, and gating escalation (single-pass vs cross-sheet reconciliation);
  - a flash-class DeepSeek model (owner: "we will be using something like deepseek 4.1 flash")
    does bulk mapping + unique-string alias resolution with context caching;
  - a reasoner-class model only for cross-sheet reconciliation ("match the pending baki sheet
    against the March dispatch sheet; import only the remaining balance");
  - a vision-capable model for photos/scans of paper registers with en/hi/gu handwriting.
  - ⚠ The chat researched model names/prices on 2026-10-26 (it quoted a "DeepSeek-V4.1-Flash",
    "Clef-flash on Workers AI" and a "Jev" router). **Re-verify current model names, prices and
    availability at build time**; the *architecture* (cheap triage → flash bulk → reasoner for
    the hard 1% → vision for paper) is the durable part.
- **F9 Cost profile (from the chat; re-verify).** Initial plant cutover ≈ **$1–2 total**;
  ≈ $0.002–0.01 per document ongoing (a customer's PDF PO, a supplier certificate photo) ≈
  **$2–5/month per active plant**. Background digest generation can be scheduled into off-peak
  windows. No subscription required — pay-as-you-go + Workers AI free-tier neurons cover triage.
- **F10 Agent-tool integration.** The vault's digests are queryable by the `orrn-mcp` agent tools
  (companion spec): "where did this opening baki for KD come from?" reads a 1 KB digest + indexed
  JSONL slices instead of re-parsing a 15 MB workbook. Reads only; writes stay drafts (rule A2).
- **F11 Guardrails.** Ingest gated owner/admin; commit gated like masters (`masters.draft` /
  `masters.publish`); prompt-injection boundary (file contents are untrusted data, notes capped
  and marked `untrusted: true`); every orrn invariant intact — tenant scope, grams/paise units,
  doc numbers only from `doc_series`, append-only ledger, bounded imports (row/file limits,
  validated in manageable batches; heavy parsing/LLM work off the request path via Queues, per
  the Worker performance rules in `AGENTS.md`).

### Delivery waves

1. **Wave 1:** R2 `ingest_artifact` vault + SHA-256 dedup + AI digest + prompt-driven
   XLSX/CSV staging UI for Masters & aliases, Die room history, pre-cutover bundles +
   `legacy_bundle_map`, open order book (baki). This is the "top priority" item in `TODO.md`.
2. **Wave 2:** PDF/photo vision ingestion, auto-merge (F6) and temporal attribution (F7) as
   first-class passes.
3. **Wave 3:** agent tools over the vault digests; ongoing ops (customer PO emails, supplier
   certificates).
4. **Native parity** after the web path is proven.

## 3. Architecture (as discussed in the chat)

```
Portal (/ingest)                Vault (R2 + D1)              Engine (server)                Commit
--------------                  --------------------------    ---------------------------    --------------------
drop any files  ──►  R2 raw.zst (immutable, dedup by SHA-256)
+ owner prompt       R2 digest.md + canonical.jsonl
                     D1 ingest_artifact registry
                          │
                          ▼
                     Extractor (sheet parser / multimodal vision)
                          │
                          ▼
                     Entity Resolver (die keys, customer/vendor aliases,
                                     legacy_bundle_map, resolve.byCode)
                          │
                          ▼
                     Staged Import Plan (ingest_batch + ingest_row)
                          │
                          ▼
                     Diff & Ambiguity Review UI ──► existing domain mutations
                     (auto-merge pass F6,          (dependency-ordered, idempotent by
                      temporal attribution F7)      clientRequestId = sha256(artifact+row),
                                                   audit_log.sourceArtifactId provenance)
```

Layer rules (from the chat, aligned with `AGENTS.md`):

1. **Layer 1 — Portal & Vault:** signed PUT upload; hash per tenant; two stored objects per file
   (lossless raw + AI-compressed digest); D1 registry row with prompt, summary, detected domains
   and detected period.
2. **Layer 2 — Prompt-guided extraction:** the user's prompt guides column/rule interpretation
   into strict Zod schemas; file contents are strictly untrusted data (prompt-injection boundary).
3. **Layer 3 — Dry-run staging (never blind writes):** follows agent-spec rule A2 — writes are
   drafts; rows resolve and validate, classify into the four states, and nothing lands until a
   person approves.
4. **Layer 4 — Idempotent, ordered commit + provenance:** every created/updated record's audit
   entry points back to the source artifact and row.

D1 sketch (all tenant-scoped, composite `(companyId, …)` indexes):

```
ingest_artifact  id · companyId · sha256 · originalName · mimeType · rawBytes · compressedBytes
                 · userPrompt · aiSummary · detectedDomains · detectedPeriod · status · createdBy · createdAt
ingest_batch     id · companyId · artifactId · targetDomain · status · stats
ingest_row       id · companyId · batchId · rowIndex · payload (validated) · state
                 (ready_create|ready_update|ambiguous|refused) · reason · resolvedRefs · asOf/period
```

## 4. History of the chat this came from (thread a8612d20-e275-49cb-a1e8-7b9e210edef5)

For the next agent: this is what already happened, so it is not redone.

1. **2026-10-26 (run 1) — merge everything done.** All finished work across ~30 worktree branches
   (FINAL-FIXES 1–5, FINAL-DOCS, FINAL-POLISH, W2/W3 floor + ageing web/native, W4 test sweep,
   EMAIL, HOTFIX sign-in/owner-link fixes, press report fit fix) was integrated, conflicts
   resolved, and validated: browser groups A 451 / B 432 / C 355 (21 existing skips), types,
   domain, server, i18n, web, native, `/` bundle under its 250 kB gzip budget; one transient
   sign-in 503 stayed recorded rather than retried away. Pushed to `main` at `b432b923`; dev
   deploy verified green. Excluded: local-only edits and later commits that removed regression
   checks.
2. **2026-10-26 (run 2) — promote to prod.** The owner approved the dev state ("I like the
   dev.orrn.app state now") and flagged that migrations would be tricky. The promotion branch kept
   the accepted app unchanged and added deployment safeguards: encrypted D1 export backup,
   local-D1 migration rehearsal of all **33 pending migrations (head 0042)** on a populated copy
   of the old `0009` production-shaped schema, post-deploy row-count + foreign-key verification.
   First rehearsal failed *before* touching live D1 (`wrangler d1 export` emits child-table
   INSERTs before `CREATE TABLE company`; stale `sqlite_sequence` after an AUTOINCREMENT rebuild);
   `production-safety.ts` (`orderExportSql`) was fixed and re-tested against a real dump. **Deploy
   Production run 40262773716 succeeded — production live on orrn.in / api.orrn.in.**
3. **2026-10-26 (runs 3–10) — the Infinity Portal discussion.** The owner asked how to fill the
   missing past: "import them from universal whatever they have with a prompt … whatever files
   they give in that injest portal is to be used to store as important artifacts compressed with
   ai". The assistant produced the 4-layer architecture above, the model routing and cost
   estimates (F8/F9; the model names cited then — "DeepSeek V4.1 Flash", "Clef-flash", "Jev" —
   came from a live search that day and must be re-verified). The owner added: no subscription is
   needed (pay-as-you-go + Workers AI); "in case of deepseek we will be using something like
   deepseek 4.1 flash"; and on 2026-10-27: "it also auto merges and auto figures out what time in
   history was the output from" (→ F6 + F7).
4. **2026-10-26 evening — follow-up promotion.** Public-homepage work landed on `main`
   (`4f15a110`) and was promoted to `prod` (`cf95efe8`) — the production state this spec builds on.

Where things are now: repo `abhalala/orrn`, `main` = `4f15a110`, `prod` = `cf95efe8`. The
`redesign/c2` checkout at `/Users/abhalala/Documents/business/fc/orrn` is the old design branch,
kept for its uncommitted concepts work; do not build from it. The `wt/INFINITY-PORTAL` worktree
off `main` is where this document and the `TODO.md` entry were committed.

## 5. Open questions for the owner (defaults in brackets)

1. Which historical data sources are on hand **right now** (FCMS SQL/CSV exports, Excel
   baki/die sheets, PDF packing lists, photos of paper registers)? [Wave 1 assumes spreadsheets
   first]
2. Start with spec + Wave 1 build as scoped above? [yes — it is the top-priority item]
3. Who may run ingest and who approves the commit? [owner/admin ingest, masters.publish-holder
   approves; same person may confirm — it is a "yes, that is what I meant", second-person
   approvals stay the approval system's job]
4. When two files disagree about the same entity and era, keep both values with provenance and
   ask, or newest-wins? [keep both, ask]
5. Are money/rate fields part of Wave 1 (order book carries `ratePaisePerKg`)? [include; visible
   only to roles that already see rates]
6. Retention: digests stay forever; raw originals too? [yes — compliance artifact]

## 6. Notes for the next agent

- Read `AGENTS.md` first; every invariant there (tenant scope, units, doc numbers, ledger,
  approvals, bounded imports, Worker CPU) applies to this feature. The companion agent-tools spec
  (`2026-10-14-orrn-agent-tools-design.md`, committed alongside this file) supplies the reads/
  drafts rule (A2) and the identity model the agent-tool queries (F10) reuse.
- Re-verify all model names, prices and free-tier numbers with a fresh search before wiring the
  router; quote what the chat found as the prior estimate only.
- The existing import screens (`import-sheet.tsx`) keep working; the portal is the superset, not
  a replacement, until parity is proven.
- Update `TODO.md` (remove/advance the top-priority item) only after Wave 1's consumer-visible
  behavior is verified on dev — per the rule at the top of that file.
