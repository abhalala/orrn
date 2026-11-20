# Vision read contract (import portal release 2)

Spec: `fc/.unslop-build/platform/VISION-BRIEF.md`. Branch `feat/vision-read`. This file is the one contract the
server and web work build against. Change it in the same commit as any code that disagrees with it.

## 1. Parameters (brief gate 2)

`packages/ingest/src/vision-params.ts`, exported from `@orrn/ingest`:

| Name | Value | Used by |
|---|---|---|
| `VISION_PARAMS.longSidePx` | 1600 | web: photo downscale, PDF render scale (`fitLongSide`, `pdfRenderScale`) |
| `VISION_PARAMS.jpegQuality` | 0.8 | web: `canvas.toBlob("image/jpeg", q)` |
| `VISION_PARAMS.tiling` | `"none"` | web and server: one image per page. Bands change page keys; the lead decides. |
| `VISION_PARAMS.maxPagesPerFile` | 30 | web renders pages 1..30; server refuses a page above it |
| `VISION_PARAMS.lowConfidence` | 0.7 | server `LOW_CONFIDENCE`, web row order and mark |
| `VISION_PARAMS.tablesPerPage` | 5 | server `MAX_TABLES`, ordinal stride |
| `VISION_PARAMS.maxPageBytes` | 4,500,000 | page ticket size, server `MAX_PAGE_BYTES` |
| `VISION_PARAMS.pageContentType` | `image/jpeg` | page tickets and the read route |

No other file may hold these numbers as literals. EVAL changes land here only.

## 2. Model route and attempts (owner decision)

- Every page (photo, scanned PDF, text PDF) starts on `claude-sonnet-5-5`. `visionStartModel` returns SONNET for every
  kind. Haiku is never asked for a vision page.
- `planVision`, Sonnet start: `invalid` (schema, checks, `output:truncated`, `output:not_json`) gets ONE retry on Sonnet
  with the validation codes. A second invalid answer: manual. `refused`: manual (no retry). `no_target`: manual (page
  "not read", reason `no_table`). Transport `error`: the same model again, at most 2 errors in a row, then manual.
  Old history rows from Haiku keep their old meaning (Haiku failure escalates to Sonnet once).
- `pdf_text` pages are read as `pdf_scan` (`pageKind` is `image` for an image artifact, else `pdf_scan`).

## 3. What a run is keyed to (brief gate 4)

- A vision run row in `ingest_bot_run` has `block_id = "<artifactId>:p<page>"` (`visionPageKey`), purpose `vision`,
  `candidate_id` null. The column has no foreign key (schema comment, migration 0049), so no placeholder block exists.
- Caps: 4 calls per page key (`BLOCK_CALL_CAP`), 300 calls and 5 USD per plant per plant day.
- A 30 page file with one retry per page is at most 60 calls (worst case at the per-page cap: 120), under 300.
  Cost at Sonnet 5.5 prices (2 USD in, 10 USD out per million): a page is about 3,000 image tokens plus the
  instructions, about 0.01 USD in; a 3,000 token answer is 0.03 USD. 30 pages with a retry each is about 2.40 USD.
  A page that hits the 16,000 token cap costs about 0.17 USD, so a file of only such pages can hit the 5 USD day
  cap near call 29. A page stopped by a cap shows "not read" with reason `cap_day_calls` / `cap_day_cost` /
  `cap_page`; capped rows are not calls, so "Read again" works the next plant day.

## 4. States

Artifact (`ingest_artifact.read_state`, no new values):

```
kept_unread --vision.start--> reading --artifact.complete (all pages settled)--> read
```

- Upload is unchanged: a PDF or photo begins `kept_unread` (no vault: refused with `KEPT_UNREAD_NO_STORAGE`, as now).
- `vision.start` moves `kept_unread` to `reading`. It is also the resume call for `reading`.
- Without a vault, without a model client, or before the raw bytes are stored, `vision.start` refuses and the file
  stays `kept_unread` with today's words.

Page (derived, never stored as a column), `VisionPageState`:

| State | Means | From |
|---|---|---|
| `waiting` | no page image in the vault yet | no `pages/<n>.jpg` object |
| `ready` | image stored, model not asked yet, or a retry is due (`next` retry) | object, runs plan `retry` |
| `read` | the model's tables are blocks | a block with `readBy model` on this page |
| `not_read` | the model gave no usable table; a person types or skips it | runs plan `manual`, or the last run capped |
| `typed` | a person entered the table by hand | a block with `readBy parser`, `headerBy person`, `readerFacts.vision.typed` true on this page |
| `skipped` | a person skipped it | `pages/index.json` `skipped` |

`reason` for `not_read` (`VisionNotReadReason`): `no_table`, `refused`, `invalid`, `too_long` (`output:truncated` twice),
`error`, `cap_page`, `cap_day_calls`, `cap_day_cost`, `page_too_large`, `unsupported_page`, `too_many_tables` (file
already holds `INGEST_LIMITS.blocksPerFile` blocks). `cap_*` pages may be read again (`canRetry: true`).

A page is settled when `read`, `typed` or `skipped`. `artifact.complete` on a visual `reading` file refuses until every
planned page is settled: "Some pages are not read yet. Read, type or skip each page first." It writes the digest as now
and returns no canonical uploads (the model rows live in staged rows; the page images are the evidence).

## 5. Vault objects

Under `tenants/<companyId>/artifacts/<sha256>/` (`artifactPrefix`):

| Key | Written by | Body |
|---|---|---|
| `raw` | browser (existing ticket) | the file |
| `pages/<n>.jpg` (n from 1) | browser, `ingest-page` ticket from `vision.start` | JPEG, at most `maxPageBytes` |
| `pages/index.json` | Worker (`vision.start`, `vision.skipPage`) | `{ v: 1, pageCount, planned, skipped: number[], startedBy, startedAt }`; updates use an R2 etag condition (`onlyIf.etagMatches`), a lost race is CONFLICT `MOVED` |
| `digest.json` | Worker (`complete`, as now) | as now |

## 6. Blocks from a page

`vision.readPage` turns each valid table `t` (0-based, at most `tablesPerPage`) of page `p` into, in one `guardedBatch`:

- `ingest_block`: `ordinal = visionOrdinal(p, t)` (the stride only keeps ordinals unique and ordered; the page of a
  block is always read from `readerFacts.vision.page`, never from the ordinal), `sheetName` null, `title` the model's title, `headerRow` 0,
  `headerRows` 1, `headerBy` "reader", headers padded and normalized as in `putBlocks`, kinds `inferKinds`, `headerKey`,
  `rowCount = rowsPut = rows`, sample the first 200 rows, `readBy` "model", `modelChecked` false, and
  `readerFacts.vision = { page: p, table: t, pageCount, rowConfidence: number[] }` (the JSON column's TS type gains
  the optional `vision` key; no migration).
- `ingest_candidate` from `fitBlock` over the learned layouts, `stateForFit`, exactly as a parser block.
- `ingest_staged_row` for every row (`capRow`, `rowKeyOf(artifactId, ordinal, i)`), state pending.
- the artifact's `blockCount` and `rowCount` grow by the new blocks; audit `ingest.vision.page`.
- unique `(artifact, ordinal)`: a second tab's insert fails and the page answers `read` with the stored blocks.
- Before the batch, the validated tables are written to the vault at `pages/<n>.tables.json`
  (`{ v: 1, runId, model, tables: VisionTable[] }`). If the batch fails after a `recipe` run (limit, conflict, Worker
  stop), the next `vision.readPage` rebuilds the blocks from that object with no model call. A `recipe` run with no
  block and no tables object is `not_read` with reason `error` and `canRetry: true` (the run is not counted as done).
- Rows: at most `MAX_ROWS_PER_TABLE` (500) per table and 5 tables, so up to 2,500 rows in one page batch. If a batch of
  that size breaks a D1 limit, insert one table per batch (each guarded on its own ordinal) rather than lower the caps.

The block then goes through the normal fit, `shape.make` (no longer refused for a model block), dry run and review.
`artifact.putBlocks` still refuses a PDF or photo (blocks of a visual file come only from `vision.*`).
`candidate.repickHeader` refuses a model block: "This table was read from a page. Fix a cell or discard it."

`BlockView` gains `vision: { page: number; table: number; pageCount: number; rowConfidence: number[]; lowRows: number[] } | null`
(`lowRows`: rows under `lowConfidence`, lowest first, then by index). A typed block has `readerFacts.vision =
{ page, table: 0, pageCount, rowConfidence: [], typed: true }` and `BlockView.vision.typed: true`; it needs no tick.

## 7. Procedures (router `ingest.vision`)

`U` = `ingest.upload`, `R` = `ingest.upload` or `ingest.merge` (the file page's guard). Company always from ctx.

| Procedure | Guard | Input | Output |
|---|---|---|---|
| `vision.start` | U | `{ artifactId, pageCount: int 1..10000 }` | `VisionStartOut = { pageCount, planned, uploads: { page, url, ticket, expiresAt }[] }` for planned pages with no image yet |
| `vision.readPage` | U | `{ artifactId, page: int 1..30 }` | `VisionPageView` (below) after at most ONE model call |
| `vision.pages` | R | `{ artifactId }` | `VisionPagesOut = { pageCount, planned, pages: VisionPageView[], settled: boolean }` |
| `vision.skipPage` | U | `{ artifactId, page }` | `VisionPageView` |
| `vision.typePage` | U | `{ artifactId, page, title: string or null, headers: string[1..50], rows: string[][1..500] }` | `VisionPageView` (state `typed`) |
| `vision.readUrl` | R | `{ artifactId, what: "raw" }` or `{ artifactId, what: "page", page }` | `{ url, expiresAt }` |
| `vision.check` | R | `{ candidateId, expectSeq, checked: boolean }` | `CandidateDetail` |
| `vision.fixCell` | U | `{ candidateId, expectSeq, rowIndex, col, text: string max 200 }` | `CandidateDetail` |

`VisionPageView = { page, state: VisionPageState, reason: VisionNotReadReason or null, canRetry: boolean, next: "retry" | "manual" | "done" | null, attempts: number, blockIds: string[], tables: number }`.

Rules:

- `vision.start`: kind must be `pdf_text | pdf_scan | image`; no vault (`!vaultReady()`): PRECONDITION_FAILED
  `KEPT_UNREAD_NO_STORAGE`; no model client (`!shapeBotReady(env)`): PRECONDITION_FAILED `KEPT_UNREAD_NOT_READ`;
  `vaultState !== "stored"`: PRECONDITION_FAILED "The original file is not saved yet. Upload the same file again, then
  approve." (existing sentence); `readState === "read"`: BAD_REQUEST "This file is already read". Writes
  `pages/index.json` when absent, sets `reading` (guarded on the old state), audit `ingest.vision.start`. Tickets:
  purpose `ingest-page`, `key = pageKey(companyId, sha256, n)`, `size = maxPageBytes`, `exactSize` false,
  `contentType = pageContentType`.
- `vision.readPage`: artifact must be `reading` and visual; `page <= planned`; page settled: answers its view with no
  call; image missing: BAD_REQUEST "Upload this page first". Reads the object (`bucket.get`), passes it to
  `runVisionAttempt` with `visualReads: true`, `vaultReady: true`, `blockId = visionPageKey`. The web calls it again
  while `next === "retry"`.
- `vision.status`: none; `IngestStatus` gains `visionReady: boolean` (= `vaultReady() && shapeBotReady(env)`).
- `vision.check`: only a `readBy model` block; candidate in `EDITABLE_STATES`; sets `model_checked`, bumps the
  candidate `serverSeq` (`candidateChange`), audit `ingest.vision.check` with `{ checked }`.
- Tick cleared (server, same batch): `vision.fixCell` and `rows.decide` on a model block. Approve refuses without the
  tick (exists: "Check these rows against the page first"), and the approve write itself carries the guard in its own
  WHERE (`not exists` a model block of this candidate with `model_checked = 0`), with the abort statement after it,
  so a tick cleared between the read and the write fails the approve (AGENTS section 2).
- `vision.fixCell` sends the candidate back to processing through the existing path that does that (the one
  `periodRerun` and `setAnswer` use, children included), not a hand-rolled update.
- `vision.fixCell`: model block only, editable state, no row of the candidate written; sets `raw[col]`, the row back
  to pending, the candidate to `processing` with `dryCursor 0`, clears the tick, audit `ingest.vision.fix` with
  `{ rowIndex, col, from, to }`. A rate column is refused to a viewer who cannot see rates.

## 8. Read path (brief gate 5)

- Tickets are not interchangeable. `handleIngestUpload` accepts only `ingest-raw | ingest-canonical | ingest-page`;
  the read route accepts only `ingest-read`. Tests cover both directions (a read ticket PUT is 403, an upload ticket
  GET is 403). `vision.readUrl` HEADs the key and signs only an object that exists (missing: NOT_FOUND "Import file
  not found").
- `GET /files/ingest/read?ticket=...` (apps/server). Ticket = the ingest ticket shape with purpose `ingest-read`
  (new `HmacPurpose`), `{ v, purpose, companyId, userId, artifactId, sha256, key, as: "raw" | "page", exp }`, 10
  minutes (`INGEST_TICKET_TTL_MS`).
- `vision.readUrl` builds the key on the server from `ctx.companyId` and the artifact row it loaded scoped by company
  (`rawKey` or `pageKey`); nothing about the key comes from the client. A row of another company is `NOT_FOUND`.
- The route verifies signature, expiry, purpose `ingest-read`, and that the key starts with
  `tenants/<companyId>/artifacts/<sha256>/` and holds no `..`; then `bucket.get(key)`; missing: 404.
- Headers: `cache-control: private, max-age=600`, `x-content-type-options: nosniff`,
  `content-security-policy: default-src 'none'; sandbox`, `referrer-policy: no-referrer`. Raw: `content-type:
  application/octet-stream` and `content-disposition: attachment` (never the stored type: a raw file is untrusted).
  Page: `content-type: image/jpeg`, inline. CORS comes from the app-wide middleware (the web fetches raw bytes).
- No public bucket, no custom domain. Security review before merge.

## 8b. New server sentences (verbatim; the web maps each in `features/ingest/lib/errors.ts`)

- "Upload this page first"
- "Some pages are not read yet. Read, type or skip each page first."
- "This table was read from a page. Fix a cell or discard it."
- "Only a table read from a page is checked against it"
- "This page is past the pages read for this file"
- "This page is already read"
- "This file is not being read page by page"
- "Only PDFs and photos are read page by page"
- "Rows of this sheet are already written. Its rows cannot change now."
- Reused as they are: `KEPT_UNREAD_NO_STORAGE`, `KEPT_UNREAD_NOT_READ`, "The original file is not saved yet. Upload
  the same file again, then approve.", "This file is already read", "Check these rows against the page first",
  `MOVED`, "Import file not found".

A new sentence needs a line here and a web mapping in the same change.

## 9. Web

- `features/ingest/lib/vision-render.ts`: pdfjs (dynamic `import()`, never in a route's static graph) renders pages
  1..min(numPages, 30) at `pdfRenderScale`; a photo is drawn at `fitLongSide`; both `toBlob("image/jpeg", jpegQuality)`.
- `features/ingest/lib/vision-pump.ts`: start, render, PUT each page to its ticket URL, then `readPage` page by page
  (again while `next === "retry"`), live region text per page, then `artifact.complete` when every page is settled.
- Upload screen: a PDF or photo with `status.visionReady` runs the pump after the raw upload. Without it: today's kept
  path and words.
- File page: `kept_unread` with `visionReady`: "Read this file" (fetches raw by `readUrl`, renders, pumps). `reading`:
  the page list with state and reason, "Read again" (`canRetry`), "Type this page", "Skip this page", progress live
  region, and the cap line ("Pages 1 to 30 of 45 were read. The rest are not read in this release.").
- Review of a model block: the page image (`readUrl` page) beside the rows, stacked under 768 px; `alt` "Page {page} of
  {count} of {file}"; low rows first and marked, blank cells marked; a real checkbox "I checked these rows against the
  page" (`vision.check`); Approve disabled until ticked; "Fix this cell" (`vision.fixCell`). Keyboard order: rows,
  tick, approve.
- Words: `ingest.vision.*` in `packages/i18n/src/ingest/en.ts`, `hi.ts` and a new `gu.ts` (partial, merged into gu).
  Server sentences through the ingest refusal words (`features/ingest/lib/errors.ts`).

## 10. Tests

Server (FakeShapeClient): start refusals (no vault, no key, not stored, read), page states, retry once on invalid,
manual after the second invalid, refusal manual, no table, caps per page and per day, page key in the run row,
blocks and rows from tables, readerFacts.vision, tick enforcement and clearing, fixCell, read ticket scope and expiry,
read route headers, complete waits for settled pages. Web: render sizing, page cap, pump order, review ordering, tick
gating. Browser spec `ingest-vision.spec.ts` on the local stack with the fake client (`/dev/ingest-bot`) and local R2
(`INGEST_VAULT` bucket `orrn-ingest-vault-local` in `apps/server/wrangler.local.jsonc`).
