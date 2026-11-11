# Imports (Infinity Portal): web logic for the screens

This folder holds everything with logic and no markup. The screen engineers build the routes and components on top
of it and do not edit it. Import from the folder: `import { ... } from "@/features/ingest/lib"`.

Stage 1 of the screens work order (`.unslop-build/platform/PORTAL-SCREENS-PLAN.md`, 2026-11-11) put every view
model, hook, action and word the screens need here. A screen reads a view model and renders it. It does not group,
count, pick a button, format a number or choose a word for itself. The section "Screens" below lists, per screen
of the work order, what to use.

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
| `useMergePump(runId)` | run id | `{ phase, run, results, chunksTotal, chunksWritten, chunksFailed, error, retry, stop }` | The words and numbers come from `mergeView(run, results, pump)`. `otherTab`: `ingest.merge.otherTab`. `stop()` is `ingest.merge.stop`. |
| `useStartMerge()` | none | `{ start(), pending, error }` | `start()` resolves `{ runId, joined }`. If a run was already active, `joined` is true and `runId` is that run: open it. Button words come from `mergeBar(...).merge`. |
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
| `seenBefore` | `ingest.drop.seenBefore` with `date = item.seenOn` (ms; `uploadStrip` formats it); "Open it" to the artifact |
| `refused` | `t(item.problem.key, item.problem.vars)`. These are `ingest.drop.tooBig`, `ingest.drop.tooManyRows`, `ingest.drop.openLimit` |
| `failed` | `ingest.read.failed`; the Retry button calls `retry(id)` |

Check a file before adding it with `fileSizeProblem(file, limits)` if you want to refuse it in the drop zone;
`add` does the same check. The picker accept string is `ACCEPT_FILES`.

## Pure helpers (`model.ts`, `limits.ts`)

| Helper | Gives |
|---|---|
| `candidateStateKey(state)`, `candidateTone(state)` | `ingest.state.<state>` and a `Tone` |
| `TARGET_KEY(target)`, `fitKeyOf(fit)` | `ingest.target.<target>`, `ingest.fit.<exact|near|none|bot|manual>` |
| `groupCandidates(list)`, `groupOf(candidate)` | The four groups in order (needsYou, ready, approved, merged). `groupOf` reads the state and `openQuestions`; held is under needsYou; a processing import is in none |
| `rowStateKey(state)`, `rowTone(state)` | `ingest.row.<state>`; `pending` has no chip |
| `rowStateCounts(counts)` | The filter chips with counts, in fixed order |
| `dryRunProgress(counts)` | 0 to 1 or null |
| `approvedSummary(list)` | `{ count, rows, create, update }` for the status block and the merge bar |
| `allowedActions(candidate, { merge, upload })` | Which of Approve, Hold, Release (Check again), Discard to enable |
| `canMergeAll(count, activeRunId, canMerge)` | Whether the merge button is on |
| `helperOffer(candidate, botReady)` | `auto`, `off` or `none` for the needs_shape card |
| `questionList(questions, target)` | `QuestionView[]`: `key`, `vars`, `varKeys`, `control`, `answers`, `answered`, `answeredWords`. Unanswered first |
| `decisionOptions(row)` | The row menu: `key`, `vars`, `decision`, `matchId` (from `row.options`, one `ingest.decide.useMatch` per live record) |
| `fitDiffView(candidate.fitDiff)` | `{ name, renamed: [{ old, new, col }], extra: [{ header, col }], missing: [{ header, field }] }`, safe on any stored shape; `col` is the column of this file |
| `diffEntries(row.diff)` | `{ field, live, file }` for the "show both" card of a conflict |
| `rateCell(row)` | `{ hidden: true }` or `{ hidden: false, value }` |
| `reasonLine(code, detail)` | `{ key, vars }` for a held or failed candidate; `key` is null when only the detail can be shown. Draw it with `reasonPieces` |
| `isRunningCandidate`, `isRunningRun`, `candidatePollMs`, `runPollMs` | Polling rules |
| `detectFileKind(name, type)`, `limitMbFor(kind)` | Kind and MB limit |

`questionView.control` says which input to draw: `unit` (a unit select for the field), `choice` (`options`, drawn as buttons:
for `rates_hidden` they are "Leave rates out" and "Hold for the owner"), `period` (financial year and as-of date, saved
with `confirmPeriod`, not `answer`), `yesNo`, `column`.

Answers are built, never typed: `answerUnit(unitId)`, `answerDateFormat`, `answerRatesHidden`, `answerColumn`, `answerYesNo`,
or `answerFromValue(code, value)` for a control's value, and sent with `actions.answer(candidateId, subject, built, expectSeq)`.
A unit is the bare unit id (`"kg"`, `"inr/kg"`). An object like `{ unit }` is not what the dry run reads.

After an answer or a row decision the server puts the candidate back to `processing` with `dryCursor` 0. `useDryRunPump`
sees that and steps again from the stored cursor; nothing to do in the screen except keep it mounted.

## Mapping editor logic (`recipe-builder.ts`)

`targetFields(target)` gives each field's `labelKey` (`ingest.field.<name>`), kind, units and whether it is required.
`initialMappings`, `addMapping`, `changeField`, `changeColumn`, `updateMapping` edit `MappingRow[]`; `mappingProblems`
reports `missingRequired`, `duplicateFields` and `unitToAsk`; `buildRecipe(block, target, rows, previous)` makes the recipe
and `checkRecipe` runs the engine's `validateRecipe`. A number with no chosen unit gets `unit: null` and an `unclear`
entry: the dry run asks "which unit is it?", nothing is assumed. A unit is only ever read from the column's header
(`Weight (kg)`) or chosen by the person.

## Words for failures and rows

- `ingestErrorWords(error, "load" | "action")` gives `{ key, retry }` from `ingest.error.*`. Never show `error.message`.
- `refusalLines(row.reasons)` and `refusalText(t, line)` word a staged row's reasons (`bad_number:weightMinG`,
  `confirm_blocked:po_number, line_1_pcs`, the blocker codes through `orders.blockers.*`). Question markers (`q:...`)
  are dropped.
- `valueCells(target, row)` gives each stored value with the unit, and, where the file said it differently, what it said
  (`entered`). A masked rate is `hidden` in both. A rate is shown in rupees from paise with `ingest.rate.unit`.
- `useDryRunPump(...).stalled` is true when another tab's upload has stopped sending rows for 30 s: say `ingest.read.stalled`.

## Which key goes with which state

The decision bar (`decisionBar`) chooses the chip, the sentence, the fit and the buttons for each state. Do not map a
state to words in a screen. `candidateStateKey(state)` is only for a place with no bar (a row's chip: use `statusChip`).

## Words, units and numbers (rule for every screen)

- A view model returns `Words`: `{ key, vars?, varKeys?, varLists?, text? }`. Draw it with `sayWords(say, words)` where
  `say = (key, vars) => translateKey(t, key, vars)`. `varKeys` are variables that are dictionary keys (a field label,
  a unit); `varLists` are lists of keys joined with ", ". `text` is a literal with no entry (a date order such as
  `dd/mm/yyyy`) when `key` is "".
- `questionText(say, question)` writes a question sentence with its field and unit as labels, never codes (S16).
- Values: `usePlantUnits()` gives the plant's formatter (`@orrn/domain`, the orrn default plus the plant's length
  setting; one line in `plant-units.ts` changes when the settings provider merges). `plant.count(1400)` is `1,400`
  and `plant.count(200000)` is `2,00,000`. Use it for every count and row total. `plant.quantity(kind, stored)` gives a
  stored value in the plant's unit, `plant.unitText(kind)` a header's unit, `plant.day(iso)` a date.
  `listFormat(plant)` is the `{ count, date }` pair the list models take.
- A stored number is never shown as stored (grams, paise, mm). `valueCells` gives `text` (mono for numbers and codes)
  and `unit` (muted sans) apart, and `fileSaid` (put `ingest.row.entered` before it) only when the file's unit differs
  from the plant's. A masked rate is `hidden`: show `ingest.rate.hidden`, no unit, no file line. The same holds for
  sample cells: `sampleValues` masks a rate column when `canSeePrices` (`can(me, "order.price")`) is false.
- Server English (the `detail` of a reason, a raw refusal line) is drawn with `lang="en"`. `reasonPieces(say, code,
  detail)` splits a reason into plain pieces and a `lang: "en"` piece. `refusalLines` gives `{ kind: "raw" }` for
  server English: wrap it the same way. On a Hindi screen wrap file and sheet names in `lang="en"` too.
- Plain words in the dictionary, a section comment per group, one dictionary file per language. Both dictionaries
  change in one commit; `bun run --cwd packages/i18n export-review` after every change.

## Screens

Below, "key" means an `ingest.` dictionary key. Every key listed exists in en and hi.

### Upload strip and the top of `/ingest` (3.1, M3, M6)

- Model: `uploadLayout(hasCandidates, hasItems)` says drop zone, header "Add files" or note field.
  `uploadStrip(items, candidates, listFormat(plant))` gives the rows of "Files being added": files in the upload
  (`words`, `progress`, `found`, `actions: retry | open | review`) and imports being checked (`kind: "checking"`, blue
  `state.processing` chip and a bar). `foundSummary(say, found)` writes "Read. 1 table: Dies, Known layout."
- Hooks: `useIngestUpload()` (add, retry, remove), `useCandidates()`, `useIngestStatus()`, `useDryRunQueue(ids)` for
  the checking imports (mount it with the ids of `state === "processing"`), `useAnnouncer()` for the status line.
- Keys: `drop.add`, `drop.title`, `drop.hint`, `drop.choose`, `drop.note`, `drop.listLabel`, `drop.done`,
  `drop.seenBefore`, `drop.openIt`, `read.progress`, `read.reading`, `read.uploading`, `read.sending`, `read.failed`,
  `read.working`, `state.processing`, `vault.off`, `helper.off`, `lead`.
- A processing import is in no segment: never list it with the others.

### Candidates list (3.2, M2, M4, M5, M13, M15, M16, S7, S8)

- Model, in order down the page:
  - `listStatus(candidates, listFormat(plant))` for the one `StatusBlock` (`titleKey`, `value`, `unit`, `meta`, `tone`).
  - `listSegments(candidates)` and `defaultSegment(segments)` for the 4-segment `SegmentedControl`; label key
    `list.segments` for its `aria-label`.
  - `fileGroups(candidates, segment, artifacts, can, listFormat(plant))` for the file headings and rows. A row has
    `title` (`rowTitle`: target key with the sheet name after it, a sheet name, or `list.newTable`), `fit` (muted
    words or null), `chip`, `numbers` (New, Updates, Questions, Cannot import), `action` (`rowAction`, one per row) and the
    reason. Group action: `group.approveAll` (`ids`, `count`) and `approveAllConfirm(group)` for its confirm.
  - `mergeBar(candidates, activeRunId, can.merge, listFormat(plant))` for the sticky `IngestBar`: `show`, `summary`,
    `merge` (button), `running` (secondary link to the run) and `hint` (the muted line at 0 approved).
    `mergeConfirm(candidates)` for the confirm sheet.
- `can = { merge: can(me, "ingest.merge"), upload: can(me, "ingest.upload") }`.
- Hooks and actions: `useCandidates()`, `useArtifacts()` (a file's date and kind; the page needs it for "added 11 Nov"
  and for the bulk rule), `useIngestStatus()`, `useStartMerge()`, `useRunAction()` (one write at a time, early return
  for `aria-disabled`, refreshes on CONFLICT), `actions.approve`, `actions.hold(id, seq, reason?)`,
  `actions.approveMany(items)` (one approve each, one refusal does not stop the rest), `useDiscardFlow` is for the
  review page. After a write: `focusAfterListAction(visibleIds, actedId)` gives the key to focus next, with
  `useFocusReturn()` (`ref(key)` on the buttons, `request([key, MERGE_BAR_FOCUS])`). `actionFocusKey(id)` is the key.
- Names of repeated buttons: `cardLabel(say, say("ingest.action.approve"), candidate)` gives "Approve: Dies, file.csv".
- Keys: `group.needsYou|ready|approved|merged`, `list.*`, `state.*`, `state.questions`, `fit.*`, `action.approve`,
  `action.hold`, `action.review`, `action.mapColumns`, `action.checkLayout`, `action.approveAll`, `action.mergeAll`,
  `action.mergeNone`, `action.merging`, `bulk.*`, `merge.confirmTitle`, `merge.confirmNote`, `merge.notYet`, `empty.*`.
- Removed from the list: Discard, Hold on ready rows, the header merge button, the second fit chip.

### Candidate review (3.3, M7, M8, M10, M11, M12, M13, M15, M16, S4, S5, S6, S9)

- Header: `reviewHeader(candidate)` (title, file, sheet, rows, columns). `reviewDocTitle(say, candidate)` for
  `document.title`; keys `docTitle.*`. While loading, a `Skeleton`, not a title.
- Decision bar: `decisionBar(candidate, { can, botReady, editorOpen })` gives `chip`, `sentence`, `refused`, `fit`,
  `reason`, `blocked` (the "Answer N questions to approve." link; `to` is "question" or "rows"), `buttons` (ids
  `approve`, `approveAsIs`, `hold`, `release`, `useLayout`, `rejectLayout`, `mapForMe`, `mapMyself` (a `toggle`: give it
  `aria-expanded` and `aria-controls`), `goMerge`, `seeFile` (links)) and `overflow` (`discard`, `ignore`). At most one
  button is primary. `moreFor` names the overflow button. The same `buttons` repeat in the sticky bar under 1024 px.
- Writes by button id: `approve` and `approveAsIs` call `actions.approve`; `hold` opens the hold sheet and calls
  `actions.hold(id, seq, holdReason(say, chipId, typed))` (`HOLD_REASONS` are the chips); `release` calls
  `actions.release` (M15, "Check again"); `useLayout` / `rejectLayout` call `actions.confirmNear(id, true|false, seq)`;
  `mapForMe` is `useBotPump(id).start`; `ignore` is `actions.setTarget(id, "ignore", seq)`; `discard` opens the confirm
  from `useDiscardFlow(candidate, { onDone })` (`open`, `working`, `error`, `words`, `ask`, `cancel`, `confirm`).
  After approve or hold: `afterDecision({ kind, approvedCount, nextId: nextNeedsYou(list, id) })` is the line in the bar.
- Year line: `yearLine(candidate, plant.day)` is `{ show: false }`, an `ask` (guess words, why, five years with the
  guess preselected, an as-on date to start from) or a `saved` line with `change`. `yearProblems({ fy, asOf })` before
  Save; then `actions.confirmPeriod(candidate.artifactId, fy, asOf)`. Saving covers the whole file, so every import of
  the file then shows the saved line. Focus the FY select only when the person opened the form.
- Questions panel: `questionList(candidate.questions, candidate.target)` gives `QuestionView`s: `key` + `vars` +
  `varKeys` (`questionText`), `control`, `answers` (buttons, all secondary), `answered` and `answeredWords`
  ("Answered: {answer}" with `q.answered`), `aboutRow` (a link to row N), `canSkipRows`. Title: `questions.title` with
  `count`. Answers are built with `answerFromValue(code, value)`, sent with `actions.answer`. The control kinds:
  `unit` (select of `units`, labels from `labelKey`), `choice`, `yesNo`, `column`, `period` (the year line, not an
  answer) and `magnitude`.
  - `magnitude` (code `magnitude_check`): answers are `as_is`, the `likelyUnit` when there is one, or any unit of the
    column from `control.units` (a select); "Skip the rows" calls `actions.skipFlaggedRows(id, control.field, seq)`.
    One answer covers the whole column of the block, as the server does. A single row is skipped with the row's own
    Skip button.
- "How orrn read this file": `readPanel(candidate, plant, canSeePrices, canChange)` gives `openByDefault`, `summary`,
  `entries` (the read-only table, same entries as the mapping editor), `canChange` ("Change mapping") and `changes`
  for a near fit: `NearChangeRow`s with a chip (`near.kindRenamed|kindNew|kindMissing`), the saved column, the column
  in this file and sample values. Keys: `read.*`, `near.*`.
- Rows panel: mount `useRowsBrowser(candidate.id, candidate.counts)` under a component keyed by `candidate.id` only. It gives
  `options` (`rowFilters`: Needs a decision first and selected when above 0, the row states, All), `filter`,
  `setFilter`, `rows` (15 per page, `items`, `hasNext`, `isLoading`), `page`, `pager` (false when one page),
  `pageWords`, `showing` (the line for the status region). Each item goes through
  `rowView(candidate, row, plant)`: `cells`, `chip`, `needsDecision`, `decisions` (inline buttons, only on rows that need
  one), `menu` (Skip, for the rest), `waitsOn` (the question; draw `rows.waitsOnQuestion`), `reasons`
  (`refusalText`), `diffs`, `chosen`, `raw`. `rowsTable(candidate, rowViews, plant)` gives the columns (unit in the
  header) and whether a decision column is needed. `cardFields(cells, expanded)` folds a card to five fields.
  `decisionButtonName(say, option, n)` names a button "Add as new, row 3"; `decisionGroupName(say, n)` the group.
  Decide with `actions.decide(id, [row.id], option.decision, seq, option.matchId)`. Never decide on a select change.
  After a decision `focusAfterRowDecision(visibleIds, rowId, stillListed)` gives the row to focus; register rows with
  `useFocusReturn().ref(rowFocusKey(id))`.
- Keys: `effect.*`, `action.release`, `action.approveAsIs`, `action.approveBlocked`, `action.goMerge`,
  `action.nextNeedsYou`, `action.approvedSoFar`, `action.heldDone`, `action.seeFile`, `discard.*`, `hold.*`,
  `period.*`, `q.*`, `questions.title`, `rows.*`, `decide.*`, `row.*`, `refuse.*`.

### Mapping editor (3.4, M9, S4)

- State: `ColumnMap` (one entry per file column). Start with `initialColumnMap(block, target, candidate.recipe)`,
  change with `assignField(map, col, field | null, target, block)` (a field moves to the column), `setColumnUnit`,
  `setColumnDateFormat`. A target change starts again: `initialColumnMap(block, next, previous)`.
- Target and name: `targetSelect(candidate)` (starts at Choose; `suggestedByOrrn`), `initialLayoutName(candidate)`
  (empty; `shape.namePlaceholder` is the placeholder), `mappingStatus(target, map)` (the live line: `needed` amber,
  `done` green, `choose`).
- Table: `columnEntries(candidate.block, target, map, plant, canSeePrices)`, one per column: header (`headerBlank` ->
  `rows.column` with `n`), `kind`, `samples` (three, cut at 32, masked for a rate), `options` (field select, Not used
  first, required and used-by words), `unit` (number select, date order, or null), `preview` (`value`, `ask`,
  `hidden`, `error`, `willNotImport`), `muted`.
- Save: `saveCheck({ target, name, map, block, previous })` gives `ok`, `summary` (`shape.fixCount`), `problems`
  (each with `words` and `focus`: name, target or a column select), `byColumn` (message under a select for
  `aria-invalid` and `aria-describedby`) and the `recipe`. On a failed Save show one `role="alert"` summary,
  focus it (`tabIndex={-1}`), each item a link to its field. On `ok` call
  `actions.saveShape(id, check.recipe, name.trim(), seq)`; show a server failure with `ingestErrorWords`.
- Keys: `shape.*`, `kind.*`, `unit.*`, `rows.column`, `period`-free. The buttons: `shape.save`, `common.cancel`.
- The "Map columns for me" button turns secondary once the editor is open: `decisionBar(..., { editorOpen })`.
- `shape.explain` goes under the needs-layout buttons. Use `useBotPump` for orrn's own try.

### File screen (3.5, S17)

- `useArtifact(id)` gives `blocks[].candidates`: build each table's row with `fileGroups`-style rows
  (`rowTitle`, `fitWords`, `statusChip`, `rowAction`) and a second line `file.columnsIn` with the headers joined.
- Header: `file.subtitle` (`rows`, `tables`, `name`, `date`) or `file.subtitleNoName` (the server sends only a user id
  today; see the server gap in the report). One muted line for the vault (`vault.notStored`, `vault.off`).
- Year line once: `fileYearTargets(blocks)` says whether the file has orders or bundles; the line itself comes from
  `yearLine` on any of its candidates. Keys: `file.*`, `vault.*`, `period.*`.

### Merge (3.6, M14, S2, S3, S10)

- `mergeView(pump.run, pump.results, pump)` gives `phase`, `title`, `status` (`tone`, `title`, `value`, `unit`, `meta`,
  `progress` by rows), `canStop`, `back`, `mergeRest`, `targetLinks` (`to` is the target's list), `held` (first, with
  `reason` and `open`), `merged`, `all`, `announce` and the row totals. Totals count only imports that merged.
- Hooks: `useMergeRun`, `useMergePump(runId)` (`stop()`, `phase` `otherTab`), `useStartMerge()` for "Merge the rest".
  Move focus to the result heading (`tabIndex={-1}`) when `phase` becomes done or stopped; announce `view.announce`
  through `useAnnouncer()` once. Draw a held reason with `reasonPieces`.
- Keys: `merge.*`, `state.*`, `action.merging`, `reason.*`.

## Hooks and actions added by the work order

| Name | What it does |
|---|---|
| `usePlantUnits()`, `plantUnitsFor(settings, env)` | The plant's formatter and unit text. Pure version for tests. |
| `useArtifacts()` | `artifact.list`, up to 500 files; each file's date, kind and confirmed period. |
| `useRowsPage(id, filter, page)` | One filter and page of 15 rows. "Needs a decision" joins ambiguous and conflict rows with no decision (the first 100 of each). |
| `useRowsBrowser(id, counts)` | Filter and page that survive a decision; falls back to All when the last undecided row goes. |
| `actions.release(id, seq)` | `ingest.candidate.release`: "Check again" on a held import. |
| `actions.approveMany(items)` | "Approve all N": one approve each, failures listed. |
| `actions.skipFlaggedRows(id, field, seq)` | Skips every undecided row flagged for `magnitude_check` on a field. |
| `useRunAction()` | One write at a time, early return while pending, refresh on CONFLICT. |
| `useDiscardFlow(candidate, opts)` | The discard confirm: `ask`, `confirm`, `cancel`, `words`, `error`. |
| `useFocusReturn()`, `useAnnouncer()` | Focus a key after a refresh; the screen's one polite status line. |
| `progressStep(prev, next)` | 0, 25, 50, 75 or 100 once per step, for long reads. |

Shared components (in `components/shared.tsx`): `IngestBar` (the sticky bar, a copy of the pack flow's), `Measure`
(mono number with a muted unit), `ProgressBar` (no live text of its own; "Working" under reduced motion),
`ReasonText` (server English in a `lang="en"` span).

## Keys the old screens still use

The old components still read these keys, and no new view model does. Delete each when its screen is rebuilt, in
the same commit as the screen (both dictionaries, then the Hindi export): `near.renamed`, `near.extra`,
`near.missing` (the "What changed" table replaces them), `merge.stopped` (`merge.titleStopped` and
`merge.partsWritten` replace it), `row.state`, `period.chip`, `merge.holds` (only if the merge screen does not keep
that line). `group.held` stays, as the work order says, for segment labels; no model uses it today.
