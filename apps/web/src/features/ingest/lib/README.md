# Imports (Infinity Portal): web logic for the screens

This folder holds everything with logic and no markup. Lane E2 builds the routes and components on top of it
and does not edit it. Import from the folder: `import { ... } from "@/features/ingest/lib"`.

Plan: `docs/superpowers/plans/2026-11-10-infinity-portal-wave1.md` (B5 procedures, B7 states, B9 screens, B10 keys).
All strings are dictionary keys from `packages/i18n/src/ingest/{en,hi}.ts`, used as `t("ingest.…")`. Helpers
return a key and its variables, never text.

Status of the contract: types, signatures and keys below are final. Every shape that crosses the wire is the
router's own type (`@orrn/server/lib/ingest/types`, exported from `./types`), so `candidate.counts.create`,
`candidate.holeName`, `row.options` and the rest are exactly what lane A returns. Counts are nested:
`candidate.counts = { total, create, update, unchanged, ambiguous, conflict, refused, skipped, written }`.

## The reading rule

Every list and detail screen reads through the hooks in `queries.ts`. They poll every 3 s (`POLL_MS`) only
while the thing they read is in a running state: candidate `processing` or `merging`, run `planning` or
`running`. Do not add your own `refetchInterval`.

## Hooks

### Queries (`queries.ts`)

| Hook | Returns | Notes |
|---|---|---|
| `useIngestStatus()` | `{ botReady, vaultReady, limits, activeRunId, botToday }` | `vaultReady` false: show `ingest.vault.off`. `botReady` false: show `ingest.helper.off`. `activeRunId` set: show the "merge running" link to `/ingest/merge/$runId`. |
| `useCandidates(state?)` | `CandidateSummary[]` | All pages of the plant, newest first. Group them with `groupCandidates`. |
| `useCandidate(id)` | `CandidateDetail` | Counts, `fitDiff` (read it with `fitDiffView`), `questions`, `block` (headers, sample, `readBy`, `modelChecked`), `period`, `rowsMissing`, `serverSeq`, `reasonCode`. |
| `useRows(id, { state?, page })` | `{ items: StagedRow[], hasNext }` | 100 per page. A row with `rateHidden` shows `ingest.rate.hidden`. |
| `useArtifact(id)` | `ArtifactDetail` | Blocks, period, vault state, candidates. |
| `useMergeRun(id)` | `MergeRunDetail` | Per-candidate results. |

Each returns `{ data, isLoading, isError, refetch }`. Use `showsQueryError` from `@/shared/lib/query-errors`
for the error panel.

### Writes (`actions.ts`)

`const actions = useIngestActions()`. Every call needs the candidate's current `serverSeq` as `expectSeq`
(read it from `useCandidate`). A stale value rejects; `isConflict(error)` is true. Then refetch and let the
person act again. Calls invalidate the right queries themselves.

`setTarget`, `confirmNear`, `saveShape`, `answer`, `decide`, `approve`, `hold`, `discard`, `confirmPeriod`,
`stopMerge`, `retireHole`. `decide` takes any number of row ids and sends them 200 at a time.

### Pumps (`use-pumps.ts`)

A pump calls one bounded server step after another. A closed tab loses nothing: any tab resumes from the stored
cursor. Phases for all pumps: `idle`, `running`, `otherTab`, `done`, `error`.

| Hook | Arguments | Returns | Keys |
|---|---|---|---|
| `useDryRunPump(candidateId, { enabled? })` | candidate id | `{ phase, state, cursor, counts, progress, rowsMissing, error, retry }` | `running`: a bar from `progress` (0 to 1, null when unknown) and `ingest.state.processing`. While `rowsMissing > 0` another tab is still sending rows: show `ingest.read.uploading` and wait, the pump does not step. `otherTab`: `ingest.merge.otherTab`. `error`: the shared "could not load" state with `retry`. |
| `useDryRunQueue(ids, { enabled? })` | candidate ids | `{ activeId, phase, byId }` | One dry run at a time, for the index screen after an upload. |
| `useMergePump(runId)` | run id | `{ phase, run, results, chunksTotal, chunksWritten, chunksFailed, error, retry, stop }` | `running`: `ingest.merge.running` with `n = chunksWritten + chunksFailed + 1` (capped at total) and `total = chunksTotal`. `otherTab`: `ingest.merge.otherTab`. `done`: `ingest.merge.done` with `created` and `updated` from `run`. Holds: `ingest.merge.holds` with `count`. `stop()` is `ingest.merge.stop`. |
| `useStartMerge()` | none | `{ start(), pending, error }` | `start()` resolves `{ runId, joined }`. If a run was already active, `joined` is true and `runId` is that run: open it. Button text is `ingest.action.mergeAll` with `count = approvedSummary(...).count`. |
| `useBotPump(candidateId)` | candidate id | `{ phase, attempt, model, lastOutcome, error, start }` | `working`: `ingest.shape.working` with `n = attempt`. `capped`: `ingest.shape.capped`. `gaveUp`: `ingest.shape.gaveUp` and open the manual editor. `done`: the candidate is now `processing`, show the dry-run bar. Start it from the "Map columns for me" button (`ingest.shape.auto`). |

A pump never starts itself for a state it cannot move. Mount `useDryRunPump` on the review screen and
`useMergePump` on the merge screen. Mounting two tabs is safe: the second shows `otherTab` and waits. If the
first tab stops moving for 30 s, the second takes over.

### Upload (`upload.ts`, `reader-client.ts`)

`const up = useIngestUpload()` gives `{ items, add(files, note?), retry(id), remove(id), busy }`. `add` keeps
the first 20 files and returns `{ left }`; say it when `left > 0`. Files go one at a time. Each `UploadItem`
has a `step`:

| `step` | Show |
|---|---|
| `queued`, `hashing` | file name, quiet bar |
| `reading` | `ingest.read.reading` with `sheet` and `rows` from `item.progress`, bar from `rowsRead / rowsTotal` |
| `saving` | `ingest.read.uploading` |
| `sending` | bar from `item.sent` (rows sent of total) |
| `done` | link to `/ingest/files/$artifactId` and the file's candidates; if `item.notStored`, `ingest.vault.off` |
| `seenBefore` | `ingest.drop.seenBefore` with `date = item.seenOn` (ms; format it with the plant's date helper); link to the artifact |
| `refused` | `t(item.problem.key, item.problem.vars)`. These are `ingest.drop.tooBig`, `ingest.drop.tooManyRows`, `ingest.drop.openLimit` |
| `failed` | `ingest.read.failed`; the Retry button calls `retry(id)` |

Check a file before adding it with `fileSizeProblem(file, limits)` if you want to refuse it in the drop zone;
`add` does the same check. The picker accept string is `ACCEPT_FILES`.

## Pure helpers (`model.ts`, `limits.ts`)

| Helper | Gives |
|---|---|
| `candidateStateKey(state)`, `candidateTone(state)` | `ingest.state.<state>` and a `Tone` |
| `TARGET_KEY(target)`, `fitKeyOf(fit)` | `ingest.target.<target>`, `ingest.fit.<exact|near|none>` (manual and bot read as `none`) |
| `groupCandidates(list)`, `groupOf(state)` | The index groups in order, with `ingest.group.<group>` keys |
| `rowStateKey(state)`, `rowTone(state)` | `ingest.row.<state>`; `pending` has no chip |
| `rowStateCounts(counts)` | The filter chips with counts, in fixed order |
| `dryRunProgress(counts)` | 0 to 1 or null |
| `approvedSummary(list)` | `{ count, rows }` for "Merge {count} approved" |
| `allowedActions(candidate, { merge, upload })` | Which of Approve, Hold, Discard to enable |
| `canMergeAll(count, activeRunId, canMerge)` | Whether the merge button is on |
| `helperOffer(candidate, botReady)` | `auto`, `off` or `none` for the needs_shape card |
| `questionList(questions)` | `QuestionView[]`: `key`, `vars`, `control`, `answered`. Unanswered first |
| `decisionOptions(row)` | The row menu: `key`, `vars`, `decision`, `matchId` (from `row.options`, one `ingest.decide.useMatch` per live record) |
| `fitDiffView(candidate.fitDiff)` | `{ name, renamed: [{ old, new }], extra, missing }`, safe on any stored shape |
| `diffEntries(row.diff)` | `{ field, live, file }` for the "show both" card of a conflict |
| `rateCell(row)` | `{ hidden: true }` or `{ hidden: false, value }` |
| `reasonLine(code, detail)` | `{ key, vars }` for a held or failed candidate; `key` is null when only the detail can be shown |
| `isRunningCandidate`, `isRunningRun`, `candidatePollMs`, `runPollMs` | Polling rules |
| `detectFileKind(name, type)`, `limitMbFor(kind)` | Kind and MB limit |

`questionView.control` says which input to draw: `unit` (a unit select for the field), `choice` (`options`),
`period` (financial year and as-of date, saved with `confirmPeriod`, not `answer`), `yesNo`, `column`.
Answer shapes sent to `answer(...)`: `unit_unknown` `{ unit }`, `date_format_ambiguous` `"dmy"` or `"mdy"`,
`rates_hidden` `"leave_out"`, `column_meaning_unclear` `{ field }`, `create_legacy_die` and `new_customers`
`true` or `false`. The router takes `answer` as `unknown`, so these are my reading of plan B7 until lane A's
`answer.set` is built; if its real shapes differ I change the helpers, not the screens.

## Which key goes with which state (review screen, plan B9)

| Candidate state | Keys |
|---|---|
| `processing` | `ingest.state.processing`, dry-run bar; `otherTab` shows `ingest.merge.otherTab` |
| `needs_confirm` | `ingest.near.title` (`name = fitDiff.name`), a list of `ingest.near.renamed`, `.extra`, `.missing`; buttons `ingest.near.use`, `ingest.near.reject` |
| `needs_shape` | `ingest.shape.auto`, `.manual`, `.ignore`; `ingest.helper.off` when `helperOffer` is `off`; while the bot runs `ingest.shape.working`; editor labels `ingest.shape.saveAs`, `.field`, `.column`, `.unit`, `.notUsed` |
| `ready` | questions (`ingest.q.<code>`), then rows; period chip `ingest.period.chip` or `ingest.period.unsure` and `ingest.period.confirm` |
| `held` | reason from `reasonLine`; `ingest.reason.*` |
| `approved`, `merging`, `merged`, `discarded` | `ingest.state.<state>`; `merged` shows counts and links |
| `failed` | `ingest.state.failed`, `ingest.read.failed` |

Vision (`ingest.vision.check`) is slice 2: render the tick only when `candidate.readBy === "model"`.

## Not here

Routes, components, nav items. Dictionary keys beyond plan B10: ask lane E1 (they are cheap to add).
