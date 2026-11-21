# Chunked raw upload (limits brief part B, 2026-11-20)

No file is refused for its size by kind any more. A raw file larger than one part goes to R2 by the multipart API
through the Worker; a file of one part keeps the single signed PUT (R2 checks its SHA-256 itself).

## 1. Facts this rests on (each checked)

| Fact | Source |
|---|---|
| Worker request body limit is 100 MB on Free and Pro zones; the API host's zone (orrn.in) is Free | developers.cloudflare.com/workers/platform/limits (request body table); zone plan checked by the lead |
| Worker memory 128 MB; CPU per request 30 s default on Workers Paid, up to 5 min; no override in `alchemy.run.ts` | same limits page; `packages/server/src/infra/alchemy.run.ts` |
| R2 parts: at least 5 MiB except the last, at most 5 GiB, at most 10,000 parts, all parts the same size except the last | developers.cloudflare.com/r2/objects/upload-objects/#part-size-limits |
| Multipart has no whole-object checksum: `R2MultipartOptions` and `R2UploadPartOptions` take no `sha256`; the completed ETag is an MD5 of part MD5s | workers-types 4.20260518.1 `index.d.ts` (R2MultipartOptions, R2UploadPartOptions); r2/objects/upload-objects/#etags |
| `uploadPart` takes a `ReadableStream` only of known length (a request body with Content-Length, or the readable half of a `FixedLengthStream`); a TransformStream output throws | r2/api/workers/workers-api-reference (put and uploadPart) |
| The binding has no `listParts` and no list of open multipart uploads; `resumeMultipartUpload` checks nothing | workers-types (R2Bucket, R2MultipartUpload); workers-api-reference |
| Unfinished multipart uploads are aborted by R2 after 7 days by default (error 10024 NoSuchUpload after that); the vault now sets a 1-day abort rule (section 13) | workers-api-reference (R2MultipartUpload definition); r2/api/error-codes |
| `crypto.DigestStream(algorithm)` is a WritableStream that keeps no data and resolves `.digest` at close | workers/runtime-apis/web-crypto/#constructors; workers-types `DigestStream` |
| `bucket.get(key, { range })` takes an `R2Range` (offset, length, suffix) or a `Headers` with Range | workers-api-reference (R2GetOptions, ranged reads) |
| pdfjs 6.4.299 has `PDFDataRangeTransport` and `getDocument({ range, rangeChunkSize, disableAutoFetch, disableStream })` | `apps/web/node_modules/pdfjs-dist/types/src/display/api.d.ts` |

## 2. Part size

`RAW_PART_BYTES = 16 MiB` (`packages/server/src/lib/ingest/upload-parts.ts`). Under the 100 MB body limit with room,
well above the 5 MiB floor, a small slice of Worker memory, and 10,000 parts cover 156 GiB. A file of at most one part
(16 MiB) keeps the single PUT. `beginInput.sizeBytes` is capped at 10,000 parts (the structural maximum), not by kind.

## 3. Server state

All under `tenants/<companyId>/artifacts/<sha256>/` (`artifactPrefix`), company from the session:

| Key | Written by | Body |
|---|---|---|
| `upload/plan.json` | Worker, `artifact.uploadStart` | `{ v: 1, uploadId, artifactId, userId, size, partSize, partCount, parts: string[] (hex SHA-256 per part), createdAt }`; `customMetadata.uploadId` too, so the part route reads only the head |
| `upload/<uploadId>/p<n>` | Worker, part route, after the part's digest matched | empty; `customMetadata.etag`; one marker per part, replaced by a later PUT of the same part, deleted by a PUT whose digest does not match |
| `upload/check.json` | Worker, whole-file check and every path that deletes raw bytes | `{ at, userId, drop? }`, created only when absent: one holder at a time; a lock older than 5 minutes is taken over only while it is still that lock (`etagMatches`); released only by its holder (head, same ETag, delete); clearing the upload folder never deletes it |
| `raw` | R2 multipart complete | the file; `customMetadata.upload = "parts"` set at create |

The session is held on the server (the plan object), not in the client: a session carrying every part digest cannot
ride in a URL (ticket payload at most 4,000 chars) and the binding cannot list parts, so the part record has to live on
the server anyway. The client holds only the artifact id. Each part goes with a short signed ticket.

## 4. Part ticket

HMAC purpose `ingest-part` (new `HmacPurpose`), 10 minutes (`INGEST_TICKET_TTL_MS`), issued just in time:

`{ v: 1, purpose: "ingest-part", companyId, userId, artifactId, sha256, key (the raw key), uploadId, part, size, partSha256, exp }`

Not interchangeable with the other tickets: the part route takes only `ingest-part`, the upload route only its three
purposes, the read route only `ingest-read`.

## 5. Procedures (`ingest.artifact.*`, guard `ingest.upload`)

- `begin`: no size refusal. A file over one part with the vault ready answers `upload: null` and
  `parts: { partSize, partCount }`.
- `uploadStart({ artifactId, parts: string[] })`: checks the count against the size; reuses the plan when its digests
  are the same (resume) and answers the part numbers already done; a plan with other digests is aborted and replaced;
  else `createMultipartUpload` and a new plan. When the raw object is there already every part is done.
- `uploadTickets({ artifactId, parts: number[] })`: up to 8 part numbers asked, tickets issued for the first 2 (a
  ticket issued far ahead of its part runs out on a slow line), digests from the plan. A plan of another person that is
  still fresh is not replaced with other parts ("Someone else is sending this file now. Try again when they finish.");
  anyone may remove it first with `uploadAbort`.
- `uploadComplete({ artifactId })`: every part recorded, else "Some parts of the file have not arrived. Add the same
  file again to send them."; `complete` with the recorded ETags; then the object is streamed once through
  `DigestStream` and must give the artifact's SHA-256 and size. The check takes `upload/check.json` first; a second
  complete while it runs gets CONFLICT "This file is still being checked. Try again in a minute.". A mismatch, or a lock
  older than 5 minutes (a check the CPU limit killed), deletes the object and the upload folder, marks the file (a PDF
  or photo; a sheet, CSV or SQL file keeps its read state and tables) `read_state = failed` with the sentence as `read_error`, and the call fails; the check is not run again until the
  file is added again. On a match the artifact is `stored` (a PDF or photo marked failed by an earlier check goes back
  to `kept_unread`); after that mark the check heads `upload/check.json` and it must still be its own lock (else the
  row goes back to `pending` and the call says the check sentence), and the object is headed again and must still have
  the ETag that was hashed. A failed check reads the row again right before its delete and keeps the bytes of a row
  that is stored by then. R2 InvalidPart on
  complete (two PUTs of one part crossed) deletes the part markers, keeps the plan and the multipart upload, and says
  "Some parts of the file have not arrived...". A NoSuchUpload on complete first checks whether another complete
  already stored the file. Idempotent: an object already there but not yet checked is checked again, never completed
  again.
- `uploadAbort({ artifactId })`: aborts the multipart upload, deletes the plan and markers, and a raw object of parts
  that is not yet stored. Refused (CONFLICT, the check sentence) while a whole-file check runs. Every path that deletes
  raw bytes (abort, discard, the daily sweep, a failed check) takes `upload/check.json` first, reads the row again
  right before the delete, and never deletes the bytes of a row that is `stored` (delta review SF1). Discarding the last
  live sheet of a file whose bytes are not stored does the same (`abortIfAbandoned`, called from
  `candidate.discard`). Called when a file is taken off the upload strip while it is saving (there is no artifact
  discard procedure; the strip's remove is the discard).
- `commitRaw`: an object with `customMetadata.upload = "parts"` is stored only through the check of `uploadComplete`.

Server sentences, verbatim (the web maps the first three in `errors.ts` `UPLOAD_SENTENCES`; the last two mean a
broken client and fall to the generic action words):

- "Some parts of the file have not arrived. Add the same file again to send them."
- "The file does not match its digest"
- "The upload ran out. Add the same file again."
- "This file is sent in one piece"
- "The part list does not match this file"
- "This file is still being checked. Try again in a minute." (CONFLICT, try again)
- "orrn could not check this file after it arrived. Remove it and add it again." (BAD_REQUEST, not retried)
- "Someone else is sending this file now. Try again when they finish." (CONFLICT)

## 6. Part route `PUT /files/ingest/part?ticket=...`

Ticket checked; Content-Length must equal the ticket's part size; the plan must still name the ticket's upload id
(else 409), read from the plan's head only (no plan body, no marker listing). The body runs through a tap into
`DigestStream` and into a `FixedLengthStream` that `uploadPart` reads; the digest is compared when the part is in. A
match writes the part's marker `p<n>` (200); a mismatch deletes that marker and answers 400 "The part does not match
its digest", so the part is missing. NoSuchUpload (the 1-day abort, or a part sent after complete) answers 410,
deletes that upload's markers and the plan only while the plan still names that upload, so the browser starts the
upload again. It never deletes `upload/check.json`: a check of the completed file may hold it.

## 7. Read route Range

`GET /files/ingest/read` answers `Range: bytes=a-b | a- | -n` with 206, `Content-Range`, `Content-Length` and
`Accept-Ranges: bytes` (also on 200); a range past the end is 416 with `Content-Range: bytes */size`; several ranges
or a malformed header get the whole object. The gate 5 headers stay. CORS allows the `Range` header and exposes
`Content-Range`, `Accept-Ranges` and `Content-Length`.

## 8. Browser

- Hash: the worker reads the file in 16 MiB slices; an incremental pure-JS SHA-256 (`lib/sha256.ts`) gives the whole
  digest and `crypto.subtle.digest` each part's, in one pass. A file of one part is hashed by `crypto.subtle` whole.
- Upload: start, then tickets for the missing parts as it goes (3 at a time), each part a `File.slice` PUT; a 403 asks
  for a fresh ticket, a 410 starts the upload again once; then complete.
- Readers: CSV counts rows as it streams and stops past the plant's rows per file; CSV, SQL text past
  `BROWSER_TEXT_MAX_CHARS` and a workbook past `BROWSER_SHEET_MAX_BYTES` stop with `too_large_to_read`. The file stays
  in the vault, the import is marked failed with that reason, and the words say it is too large to read in this browser.
- PDFs open through a range source (`PDFDataRangeTransport`) over `File.slice` on upload, and over signed range reads
  (the link asked again before it runs out) for "Read this file".

## 9. Tests

Server: multipart upload, wrong part digest, wrong whole digest, resume, abort on discard, commitRaw inside the window,
part ticket scope, read route Range (206, 416, headers). SF1: abort, discard, the sweep and a check past 5 minutes each
held (controlled promises) while a check finishes, and the stored file survives; a late part PUT leaves the lock. Web: incremental SHA-256 against a reference, the part upload
order and resume, the reader ceilings. Browser: one file just over one part through the local stack (workerd and local
R2).

## 10. Measured after the build

- `crypto.DigestStream` on workerd (Miniflare, Apple Silicon): 256 MiB in 88 ms, 1 GiB in 357 ms. The whole-file check
  of `uploadComplete` runs in one request under the 30 s CPU default, so on this machine it would cover tens of GiB. Not
  measured on the Cloudflare edge, whose CPUs may be slower.
- Fix round, 2026-11-20, same machine with other lanes running (load 2 to 9), wall time from outside the Worker, best of
  two, synthetic `ReadableStream` inside the Worker through `streamSha256` (`stream-digest.ts`):
  - with the old JS counter step per chunk: 16 KiB chunks 1 GiB in 1,860 ms (550 MiB/s); 64 KiB chunks 1 GiB 567 ms,
    2 GiB 2,067 ms, 4 GiB 5,688 ms (720 to 1,800 MiB/s). The per-chunk JS step dominated at small chunks.
  - piped straight into `DigestStream` (shipped): 16 KiB chunks 1 GiB in 604 ms (1,696 MiB/s); 64 KiB chunks 1 GiB in
    383 ms, 2 GiB in 763 ms (2,685 MiB/s). Generating the stream alone took 58 to 326 ms of that.
  - a 512 MiB object in local R2: read only 772 ms, read and hashed 927 ms (local disk bound; waiting on R2 is not CPU
    time on the edge).
  - Ceiling: 2 GiB (`uploadFileMiB`), against the 30,000 ms CPU default per request on Workers Paid (no
    `limits.cpu_ms` override in `alchemy.run.ts`; the account is on Workers Paid, which allows up to 300,000; an
    override would also cap the daily cron, whose default for a daily trigger is 15 minutes, so none is set). At the slowest shipped rate 2 GiB is
    about 1.2 s, 25x under the limit; the edge would have to be 8x slower than this laptop before the 3x margin is
    gone. Not measured on the edge.

## 13. Unfinished uploads (fix round 2026-11-20)

- The vault bucket carries one lifecycle rule (`alchemy.run.ts`): `abortMultipartUploadsTransition` after 86,400 s,
  prefix "" (no delete transition; raw files are kept forever). Alchemy 0.91.2 `R2Bucket` supports `lifecycle` and
  PUTs `/accounts/<id>/r2/buckets/<name>/lifecycle`, which replaces the bucket's rules, R2's default 7-day abort
  rule included. It applies on the next deploy of each stage that has the vault. Check after promotion, read only:
  `cf r2 buckets lifecycle get <bucket>` should list `abort-unfinished-uploads-1d`.
- A plan is resumed only within 20 hours (`PLAN_RESUME_MS`).
- The daily cron (`sweepUnfinishedUploads`): files still `pending` whose row crossed the one-day line in the last two
  days (newest first, at most 500 a run) lose their plan,
  markers and any unchecked object made from parts, under the check lock and only while the row read again is not
  stored; a file sent in one piece whose commit never came is marked stored.
  Rows stay `pending` otherwise (the approve gate refuses a file whose bytes are not stored).
- The storage quota counts stored files plus `pending` rows touched in the last day; a re-add of a file touches its row
  under the quota check.

## 14. What the web needs from this round

- `company-limits-tab.tsx`: names and hints for `uploadFileMiB` (MiB) and `vaultQuotaGiB` (GiB); both type-check
  failures go away with them.
- `upload.ts` `problemFromError`: call `beginRefusalWords(error)` from `errors.ts` first; it gives the key and the
  values (name, limit or size) for the no-vault refusal by kind and the size and storage refusals.
- `artifactUploadComplete` may answer CONFLICT "This file is still being checked..." (mapped, retry) and BAD_REQUEST
  "orrn could not check this file..." (mapped, no retry: the file must be added again).
- `artifactUploadStart` may answer CONFLICT "Someone else is sending this file now..." (mapped), and the storage
  refusal (PRECONDITION_FAILED, the same words as `begin`) when a new multipart upload would pass the quota.
- `artifactUploadTickets` answers at most 2 tickets however many are asked; the current loop already asks again for a
  part with no ticket. The "7 days" comment in `upload-parts.ts` (web) is now 1 day.

- Browser incremental SHA-256 (pure JS, bun): 600 MiB in about 3 s.
- The local stack (`ingest.spec.ts`, "files over one part"): a padded 16 MiB + 70 KB PDF goes up in two parts with a
  wrong part refused (400), the whole file checked, and a range read answers 206 with the range headers exposed; a 17.5
  MB CSV goes up in parts through the screen and is read.

## 11. DuckDB-WASM (owner decision 2026-11-20, brief section D): not adopted now

Tried `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (npm `latest`) in a scratch page, outside the repo (no `bun.lock` change).

| Check | Result |
|---|---|
| CSP | The web app sends no Content-Security-Policy (`webEdge.ts` sets only HSTS), so nothing blocks it today. A CSP added later needs `'wasm-unsafe-eval'`, a worker source, and a source for the extension files. |
| Size | `duckdb-eh.wasm` 35.9 MB (8.1 MB gzip, 5.3 MB brotli), worker 0.77 MB, plus `apache-arrow`. |
| Hosting | Fails: Workers static assets take at most 25 MiB per file (developers.cloudflare.com/workers/platform/limits/#static-assets), so the wasm cannot ship in `apps/web/dist`. It would need an R2 custom domain or a third-party CDN. The Excel extension is fetched from extensions.duckdb.org unless it is hosted too. |
| 515 MB CSV, 1,000,000 rows, every cell decoded to a JS string | Chromium (Playwright 1248, headless): 0.3 s start, 2.0 s scan, browser RSS 268 MB to 1,067 MB at peak. WebKit 26.4 (Playwright, the engine of Safari, not Safari itself): 1.7 s start, 1.8 s scan, RSS 342 MB to 1,973 MB at peak. |
| Same CSV, today's way (`file.text()` and a split into lines, no parse) | Chromium 0.4 s, RSS to 757 MB; WebKit 0.5 s, RSS to 2,052 MB. The table readers would then hold every row again, which is why the stream now stops at `BROWSER_TEXT_MAX_CHARS`. |
| Excel (synthetic book: a merged title row over four columns, two sheets, date cells) | Fails. In Chromium `read_xlsx` with `header=false` returned only column A (the merged title row set the width), there is no function that lists sheet names, and merges are not reported; dates came back typed only with an explicit range. In WebKit the extension did not load (network error) and the next calls failed with wasm runtime errors. |
| SQL dumps | Not a fit: DuckDB does not read a MySQL or Postgres dump's INSERT text as a table. |
| Not measured | Real desktop Safari (needs Remote Automation turned on by the owner), phones, and a large xlsx (the Excel check failed first). |

Even for CSV, its gain needs a different upload path: today every row of a file is held in the tab until the headers
are settled and the rows sent (`upload.ts`, `ReadBlock.rows`), so a 1,000,000-row file runs out of memory whatever
parses it. A DuckDB lane would have to send rows to `putRows` batch by batch as it scans.

Fallback in place (B.4): CSV and SQL are read as streams, and a CSV stops at the rows per file. CSV or SQL text past
150 M characters, and a workbook past 40 MB (twice the old upload limits; chosen, not measured in the reader worker), are kept in the vault with plain words ("too large for this browser to
read"). Phones keep the same readers.

If the owner wants files past those sizes read in the browser, the next step is a CSV-only DuckDB lane: the wasm on
an R2 custom domain, lazy loaded on the import page, rows streamed in `rowsPerPut` batches, desktop only.

## 12. New plant limits (fix round 2026-11-20, for the Godseye Limits tab)

Two keys added to `PLANT_LIMIT_KEYS` in `packages/server/src/lib/plantLimits.ts`, stored, written and resolved like
the others (`companiesSetLimits`, `effectiveLimits`), whole numbers from 1 to the ceiling. `uploadFileMiB`: the
largest raw file per upload, in MiB (1,048,576 bytes), default 2,048 (2 GiB), ceiling 2,048, so staff can only lower
it; the ceiling is the size the whole-file SHA-256 check finishes in one request with margin (section 10).
`vaultQuotaGiB`: the plant's storage quota, the raw bytes kept in the vault, in GiB (1,073,741,824 bytes), default 50,
ceiling 1,024 (1 TiB); counted from D1 (`ingest_artifact.size_bytes` of stored files plus uploads begun in the last
day), never from R2 listings. Both are checked in `artifact.begin`. `PLANT_LIMITS[key]` carries the default and
ceiling; `MIB`, `GIB` and `UPLOAD_FILE_CEILING_BYTES` are exported beside them. The web's `NAME_KEYS` and `HINT_KEYS`
(`company-limits-tab.tsx`) are `Record<PlantLimitKey, ...>`, so the web type-check fails until the two keys get names
and hints there.
