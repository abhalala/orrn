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
| Unfinished multipart uploads are aborted by R2 after 7 days (error 10024 NoSuchUpload after that) | workers-api-reference (R2MultipartUpload definition); r2/api/error-codes |
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
| `upload/plan.json` | Worker, `artifact.uploadStart` | `{ v: 1, uploadId, artifactId, userId, size, partSize, partCount, parts: string[] (hex SHA-256 per part), createdAt }` |
| `upload/<uploadId>/<n>` | Worker, part route, after the part's digest matched | empty; `customMetadata.etag` |
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
- `uploadTickets({ artifactId, parts: number[] })`: at most 8 tickets a call, digests from the plan.
- `uploadComplete({ artifactId })`: every part recorded, else "Some parts of the file have not arrived. Add the same
  file again to send them."; `complete` with the recorded ETags; then the object is streamed once through
  `DigestStream` and must give the artifact's SHA-256 and size. A mismatch deletes the object and the plan and says "The
  file does not match its digest". On a match the artifact is `stored` and the plan and markers go. Idempotent: an
  object already there but not yet checked is checked again, never completed again.
- `uploadAbort({ artifactId })`: aborts the multipart upload, deletes the plan and markers, and a raw object of parts
  that is not yet stored. Called when a file is taken off the upload strip while it is saving (there is no artifact
  discard procedure; the strip's remove is the discard).
- `commitRaw`: an object with `customMetadata.upload = "parts"` is stored only through the check of `uploadComplete`.

## 6. Part route `PUT /files/ingest/part?ticket=...`

Ticket checked; Content-Length must equal the ticket's part size; the plan must still name the ticket's upload id
(else 409). The marker of that part is deleted first, the body runs through a tap into `DigestStream` and into a
`FixedLengthStream` that `uploadPart` reads; the digest is compared when the part is in. A match writes the marker
(200); a mismatch answers 400 "The part does not match its digest" and leaves the part missing. NoSuchUpload (the 7
day abort) answers 410 and clears the plan, so the browser starts the upload again.

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
part ticket scope, read route Range (206, 416, headers). Web: incremental SHA-256 against a reference, the part upload
order and resume, the reader ceilings. Browser: one file just over one part through the local stack (workerd and local
R2).

## 10. DuckDB-WASM (owner decision, brief section D)

See the section at the end, written after the upload ships.
