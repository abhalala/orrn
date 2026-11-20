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
| `VISION_PARAMS.maxPagesPerFile` | 30 | default pages per batch (`visionPagesPerBatch`, section 12); a file is read batch by batch |
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

`next` (built): `"retry"` only when the next `vision.readPage` makes a model call (after one invalid answer or one
transport error) or rebuilds blocks from `pages/<n>.tables.json`; `null` for `waiting` and for `ready` with no call
yet; `"manual"` for `not_read`; `"done"` when settled. A full file (`too_many_tables`) is manual before any call. A
`recipe` run whose tables object is missing counts as an `error` run for the plan: one is `not_read`/`error` with
`canRetry: true`, two in a row is `canRetry: false`.

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
  `readerFacts.vision = { page: p, table: t, pageCount, rowConfidence: number[], tables: n }` (`tables`: the number
  of valid tables of that page; the JSON column's TS type gains the optional `vision` key; no migration).
- `ingest_candidate` from `fitBlock` over the learned layouts, `stateForFit`, exactly as a parser block.
- `ingest_staged_row` for every row (`capRow`, `rowKeyOf(artifactId, ordinal, i)`), state pending.
- the artifact's `blockCount` and `rowCount` grow by the new blocks; audit `ingest.vision.page`.
- unique `(artifact, ordinal)`: a second tab's insert fails and the page answers `read` with the stored blocks.
- Before the batch, the validated tables are written to the vault at `pages/<n>.tables.json`
  (`{ v: 1, runId, model, tables: VisionTable[] }`). If the batch fails after a `recipe` run (limit, conflict, Worker
  stop), the next `vision.readPage` rebuilds the blocks from that object with no model call. A `recipe` run with no
  block and no tables object is `not_read` with reason `error` and `canRetry: true` (the run is not counted as done).
- Rows: at most `MAX_ROWS_PER_TABLE` (500) per table and 5 tables. Built: one table per `guardedBatch` (at most 500
  rows, the size `putRows` already writes), each guarded on its own ordinal by the unique index, with the artifact
  update first (`read_state = 'reading'`, `block_count < blocksPerFile`, and no block of the other kind on the page:
  a typed table and model tables never share a page) and its abort statement. The room for every missing table of
  the page is checked before the first. A page is `read` only when its model blocks number `readerFacts.vision.tables`;
  a page with fewer (a batch stopped after table 0) is `ready` with `next: "retry"`, and the next `vision.readPage`
  inserts only the missing ordinals from `pages/<n>.tables.json`, with no model call. A rebuild that fails throws (the
  web stops its loop on an error, never on `retry`).

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
| `vision.readPage` | U | `{ artifactId, page: int 1..10000 }` (the plan is checked in the handler, section 12) | `VisionPageView` (below) after at most ONE model call |
| `vision.pages` | R | `{ artifactId }` | `VisionPagesOut = { pageCount, planned, pages: VisionPageView[], settled: boolean }` |
| `vision.skipPage` | U | `{ artifactId, page }` | `VisionPageView` |
| `vision.typePage` | U | `{ artifactId, page, title: string or null, headers: string[1..50], rows: string[][1..500] }` | `VisionPageView` (state `typed`) |
| `vision.readUrl` (query) | R | `{ artifactId, what: "raw" }` or `{ artifactId, what: "page", page }` | `{ url, expiresAt }` |
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
- "This file already holds 50 tables, the most one file can hold. Finish it to use the tables read so far." (section 12)
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
  region, and the batch lines of section 12 (the old cap line is gone).
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

## 11. Lead decisions from EVAL (2026-11-20, `fc/.unslop-build/platform/VISION-EVAL-REPORT.md`)

These override sections 1 to 10 where they disagree.

1. **Page size 2400 px**, JPEG 0.8 (`VISION_PARAMS.longSidePx`). `maxPageBytes` is now 3,700,000: the API image limit
   is 5 MB and the image goes as base64 (4/3 larger); EVAL's largest 2400 px page was 680 KB.
2. **Prompt v3 and row objects.** `visionOutput` rows are `{ cells: string[], confidence: number }` (strict);
   `rowConfidence` is gone. `VISION_INSTRUCTIONS` is the v3 text of the EVAL report, verbatim. `checkVisionTables`
   checks `row.cells.length` against the headers and `row.confidence` in 0..1 (no `confidence_count`).
   `finishTables` reads them. Stored `readerFacts.vision.rowConfidence` is still one number per row (taken from the
   row objects), so `BlockView.vision` is unchanged.
3. **Bands for dense pages** (`VISION_PARAMS.tiling = "bands"`, `bandRowThreshold` 100, `bandMaxRows` 65,
   `maxBandsPerPage` 4).
   - Text PDF: the browser counts row lines from the pdfjs text layer before any call. Past the threshold it cuts the
     page into k bands (k = ceil(lines / bandMaxRows), at most 4) on gaps between text lines, never through a line,
     no overlap, and draws the header strip (the text lines above the first body line) on top of bands 2..k. Every
     band image is `longSidePx` wide.
   - Scan or photo: the whole page is read first. If the answer holds more than `bandRowThreshold` rows of one table, or
     is `output:truncated`, `readPage` answers `next: "band"` with the headers. The browser cuts the page image on
     whitespace gaps (horizontal ink projection on the canvas; a cut row must be blank) and uploads the bands.
   - Band keys: image `pages/<n>/b<k>.jpg`; run key `visionBandKey(artifactId, n, k)` = `<artifactId>:p<n>:b<k>`. Band 1
     is read first; bands 2..k are told, in the user text, "This is band k of K of one page. The table's headers are:
     <JSON of band 1's headers>. Copy only the body rows in this band; do not copy the header strip at the top." The
     headers text is data from the first read and goes inside a JSON string, never as an instruction.
   - Procedures: `vision.bandTickets({ artifactId, page, bands: 2..4 })` returns one ticket per band;
     `vision.readPage({ artifactId, page, band?: 1..4 })` reads one band. A band answer must be one table whose width
     equals band 1's headers, else invalid (`vision:band_width`) and the normal one retry.
   - Merge (server, pure function, tested): bands in order, rows concatenated; a first row of band k >= 2 equal to the
     headers (the strip read as data) is dropped; nothing else is de-duplicated (cuts have no overlap). Tests: no row
     duplicated or dropped at any band edge, the header row dropped once, widths checked. The merged table becomes one
     block per page (the page's tables from band 1 other than the banded table are kept as their own blocks).
   - Page view: `bands: { total, read }` while banding; the page is `read` only when every band is read.
   - Calls and caps: each run key has its own 4-call cap, so a page with 3 bands plus one retry each never meets the
     cap on one key. A 30 page file: whole pages only, 30 calls (60 with a retry each). Every page a dense text PDF
     at 3 bands: 90 calls (180 with a retry each). Every page a dense scan: 1 whole + 3 bands = 120 calls (240 with
     retries). All under 300 calls. Cost: a band is about 6,000 output tokens (0.06 USD) plus 0.01 USD in, so 90
     band calls are about 6.30 USD and pass the 5 USD day cap near call 70; such a file finishes the next plant day
     ("Read again" on `cap_day_cost` pages). Open question for the lead: the plant's CPA route is a subscription, so
     the 5 USD cap may be set too low for dense files.
4. **Confidence is not a safety signal.** Rows under 0.7 are still listed early and marked, but no word on any screen
   says or suggests that a confident row is right. The tick against the page image carries the check.
   `ingest.vision.check` ("orrn checked these rows against the original page.") is wrong (a person checks); reword.
5. **Text-layer digit check (brief gate 6), built.** For a text PDF page the browser uploads the page's pdfjs text as
   `pages/<n>.text.json` (`{ v: 1, items: string[] }`, at most `maxPageTextBytes`, an `ingest-page` ticket with
   content type `application/json`, issued by `vision.start` for text PDFs). When blocks are made, the server marks
   a cell when one of its digit runs (`\d+` after removing thousands commas) is not a digit run anywhere in that
   page's text. Marks go in `readerFacts.vision.unseen: [row, col][]`; `BlockView.vision.unseen` carries them. The
   text only adds marks; missing text means no marks. Review order: rows with a marked cell first, then rows under
   0.7, then the rest; marked cells say "These digits are not in the PDF's text. Check them against the page."
6. **A cell that holds an instruction is data.** It is copied, stored and shown as text and never acted on; a test
   keeps an instruction-like cell as a plain cell value.
7. **Server shapes as built (server lane, 2026-11-20).** These fill gaps in items 3 and 5.
   - The banded table of band 1 is the table with the most rows (the last one on a tie). Prompt v3 does not promise
     an order of tables, so the rule does not depend on one. Its headers go to bands 2..K for both kinds; a scan's
     whole-page read is used only to decide that the page is dense.
   - `VisionPageView` gains `next: "band"`, `bands: { total, read, next } | null` (`next` is the band `readPage`
     reads next, null when all are read) and `bandHeaders: string[] | null` (the dense table's headers with
     `next: "band"`; null when the answer was cut off). A text PDF that is cut off keeps its retry and then
     `too_long`; only a scan or photo goes to bands.
   - `vision.readPage({ artifactId, page, band? })`: left out, it reads the next band. Bands 2..K wait (no call)
     until band 1 is read. A band past the plan is refused as `MOVED`. The bands are merged on every build from
     `pages/<n>/b<k>.tables.json`; no merged object is stored. The block's `readerFacts.vision.bands` is K.
   - `vision.bandTickets({ artifactId, page, bands })` answers `VisionBandTicketsOut { page, total, uploads:
     { band, url, ticket, expiresAt }[] }`. The count is written once into `index.json` (`bands: { "<n>": K }`,
     etag guarded, audit `ingest.vision.bands`). The same count again hands the missing tickets; another count is
     refused as `MOVED`; a read or typed page is refused with "This page is already read". `vision.start` hands no
     page ticket for a page cut into bands.
   - `vision.readUrl({ artifactId, what: "page", page, band? })` signs a band image.
   - `VisionStartOut.texts`: the text tickets (text PDF only). `BlockVisionView.unseen: [row, col][]` and
     `BlockVisionView.bands: number | null`. Digit runs: a comma between two digits is removed, each text item is
     read on its own (two items never join into one run), and whole runs are matched, never a part of one.
     "Fix this cell" clears that cell's mark.
   - No new refusal sentence.

## 12. Batches (limits brief part C, 2026-11-20)

These override sections 1 to 11 where they disagree. A file with more pages than the plant's pages per batch
(`visionPagesPerBatch`, default 30, ceiling 80, set in Godseye) is read one batch at a time.

### Index shape (`pages/index.json`)

```
{ v: 1, pageCount, planned, skipped: number[], startedBy, startedAt,
  bands?: { "<n>": K },
  batches?: [from, to][],          // each planned range, in order; missing in an older index: [[1, planned]]
  restNotRead?: { by, at } }       // a person finished with pages planned + 1 to pageCount not read
```

- `pageCount` is the whole file (from the browser's pdfjs count, at most 10,000). `planned` is the last page in the plan
  and only grows. Every write after `vision.start` is etag guarded (`onlyIf.etagMatches`); a lost race is `MOVED`.
- `vision.start` writes `planned = min(pageCount, visionPagesPerBatch)` and `batches: [[1, planned]]` once. It never
  extends the plan; a second start resumes as it is (the plant's later batch size applies only to later batches).

### Procedures

| Procedure | Guard | Input | Output |
|---|---|---|---|
| `vision.nextBatch` | U | `{ artifactId }` | `VisionStartOut` |
| `vision.finishRest` | U | `{ artifactId }` | `VisionPagesOut` |

- `vision.nextBatch` ("Read next pages"): the file must be `reading` and a model route must exist (else today's
  refusals). A page is open for the model when it is `waiting` or `ready` (not `next: "band"`), or `not_read` with
  `cap_day_calls` / `cap_day_cost` (`openForModel`, server and web). While any planned page is open, or every page is
  planned, nothing is planned and the missing tickets of the whole plan come back (a double click or a second tab
  plans nothing twice). A file holding `blocksPerFile` tables is refused: BAD_REQUEST "This file already holds 50
  tables, the most one file can hold. Finish it to use the tables read so far." Otherwise it plans `planned + 1` to
  `min(pageCount, planned + visionPagesPerBatch)` with the plant's value now, appends the range to `batches`, clears
  `restNotRead`, writes audit `ingest.vision.batch { from, to, pageCount }`, and hands tickets for that range only.
- Pages only a person can settle (manual reasons, `cap_page`, `too_many_tables`, a page waiting to be cut) never hold
  the next batch back.
- `vision.finishRest` ("Finish without pages N to M", and "Skip the rest and finish" on a full file): in one etag
  guarded write, every planned page not settled is added to `skipped`, and when `planned < pageCount` the index gets
  `restNotRead`. Audit `ingest.vision.rest { skipped: number[], notRead: [from, to] | null }`. Answers `vision.pages`.

### Finish (decision)

A file is complete when every planned page is settled AND either every page is planned (`planned >= pageCount`) or a
person left the rest (`restNotRead`). `artifact.complete` refuses otherwise with the existing "Some pages are not read
yet. Read, type or skip each page first." (`visionAllSettled`). `VisionPagesOut` gains `full` (the file holds
`blocksPerFile` tables), `restNotRead` and `canFinish` (exactly what complete requires). The pump never completes a
file with pages past the plan; only a person's "Finish without pages N to M" does.

### Listings and page numbers

- Page numbers in every vision input go to 10,000 (`VISION_FILE_MAX_PAGES`); the plan is checked in the handler
  ("This page is past the pages read for this file").
- Every R2 listing asks for 1,000 keys a call and follows the cursor (`listKeys`), bounded by the keys the plan can hold
  (11 per page). A single page (`readPage`, `skipPage`, `typePage`, `bandTickets`) lists only `pages/<n>.` and
  `pages/<n>/`. The runs of a whole file come from one range on `block_id` (`<id>:p` to `<id>:q`) instead of IN lists.
- A whole-file listing of a fully planned 10,000 page file is about 30 list calls (three keys a page); the batch
  ceiling 80 stays as a bound on one click's work, not on the listing.
- Ordinals: page 10,000 gives ordinal 49,995; a candidate's `createdAt` is `at + ordinal` ms, so up to about 50 s ahead
  for the last pages of a huge file. Only the order within a file uses it.

### States and words (web)

- Day cap: the pump stops the pass at the first page that answers `cap_day_calls` / `cap_day_cost` (later pages would
  only be capped too). The file page says "Today's spend on the model is used up. Read next pages carries on from page
  {page} tomorrow." (or the calls line), and "Read next pages" carries on from that page through the plan: the same day
  if the caps were raised, else the next plant day. Pages already stored need no bytes.
- A batch read through with pages past the plan: "Pages read: 1 to 30." (`ingest.vision.readRanges`, ranges of read or
  typed pages), "Pages 31 to 100 of 100 are not read yet.", "Read next pages" with "Reads pages 31 to 60." (fetches the
  raw bytes, plans the batch, draws and reads only its pages), and "Finish without pages 31 to 100".
- A full file: "This file holds 50 tables, the most one file can hold. The tables read so far can still be checked and
  imported." and "Skip the rest and finish" while planned pages are open. Tables already read stay usable.
- Upload strip: pages past the plan count as not read in "{count} pages are not read".
- New server sentence: the full-file sentence above, listed in 8b and mapped to `ingest.vision.error.fileFull`.

### Calls and cost

- A batch of 30 dense pages at the defaults: a text PDF at 3 bands is 90 calls; a scan is 1 whole read plus 3 bands, 120
  calls. The 300 call cap does not bind. At about 0.07 USD a band call, `checkCaps` allows a call while the day's spend
  is under 5 USD: 71 calls spend 4.97 USD, call 72 goes (5.04 USD), call 73 is capped. A dense batch finishes the next
  plant day with "Read next pages".
- 100 pages one table each: four batches (30, 30, 30, 10). Whole pages only: 100 calls at about 0.04 USD (section 3), about 4 USD: one plant day if few pages need a retry, else two. Dense
  text at 3 bands: 300 calls, about 21 USD, so about 72 calls a day at 5 USD: five plant days. The day call cap (300)
  is never the wall at 5 USD. The 50-table file limit binds first for any file with more than 50 tables: at one table a
  page, page 51 onward is `too_many_tables`; such a file cannot be read whole in one artifact (owner decision).

