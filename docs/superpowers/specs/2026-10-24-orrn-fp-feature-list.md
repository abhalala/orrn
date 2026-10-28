# ORRN floor parity — master feature list

Date: 2026-10-24. Status (2026-10-26): implementation inventory after FINAL-FIXES-4/5 integration; current verification is recorded in the build ledger and final report. Planned at `08a3ead`.

This is the master list in ORRN words. Each row is a capability an ORRN user can use. Competitor evidence stays in the module specs; this file does not reuse their screen names.

Sources: the seven module specs `docs/superpowers/specs/2026-10-24-orrn-fp-*-design.md`, the plant-modules spec and plan (PL-n), and the 2026-10-24 competitive report §3. Demo routes are the fixture pages those specs name under `/preview`. A dash means the spec does not put that feature on a demo page.

**Count: 128 features in this file; 138 in the build.** DR 16, OP 19, PR 22, FD 20, AG 17, PK 16, PF 18 are here. The ten re-pass rows (DR-17 to DR-20, OP-20, OP-21, PR-23 to PR-25, PK-17) live in the module specs. Implementation inventory: 136 Built, including PR-21, PR-22, FD-12, AG-17 and PK-02 with simulators pending plant hardware (scale Q5, PLC Q46, spectrometer Q47, oven sensor). FINAL-FIXES-4 closes FD-02, FD-11, FD-19 and AG-15. PK-06 (no Bluetooth printer at the plant) and PF-18 (own account on any phone, Q33) remain Deferred. “Built” does not claim real-device, production, email-provider or R2 subscription verification.

Vocabulary: die = section catalogue row. Die copy = `die_instance` (the physical oblique). Drift reading = latest kg per 12 ft. Tier change = approved rank or band lift. Cast, melt, billet, press run, ageing batch, pack, bundle, sales order, baki, packing list (PL), dispatch, kanta, store, approvals, Today — as in `AGENTS.md` and `packages/i18n/src/en.ts`. New terms, coined in the specs: **plant stock** (a bundle moved off every sales order by a transfer, not a fake customer), **press line** (a physical press), **press plan** (the shift's die list), **pressed** (logged good kg and pieces; it does not move baki), **cycle recipe** (temperature, soak, hardness band snapshotted onto an ageing batch).

---

## Die room — FP-DR

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-DR-01 | Section and permanent copy code | As the die room, I open 12170 Domal and see copies 12170-1, 12170-2, with codes the floor can say and scan. | Built prod (section CRUD, `/dies`). c2 server only (copy allocate-on-insert). Planned PL-W5 for the copy UI. | Now | — | `/preview/die-room` | **Built.** die.create/update; dieInstance.create; /dies, /dies/$id, /dies/copies/$copyId |
| FP-DR-02 | Duplicate guard that still lets a second copy in | As the die room, I add another physical copy without being blocked, and I am stopped only when I create the same commercial band twice, with the existing row named. | Built prod (unique series + section code, error names a live or deleted clash). No band-level guard. A second copy already succeeds on c2. | Now | FP-DR-03 | `/preview/die-room` | **Built.** dieBand.create CONFLICT names the band; band-form |
| FP-DR-03 | Several bands under one section | As the die room, I keep 8 mm and 10 mm, or 5.9–6.2 and 6.2–6.6 kg/12 ft, under one section code instead of inventing a second section. | Planned P4. One band on the section. Copies share it. | Now | — | `/preview/die-room` | **Built.** dieBand.list/create/update/retire; section bands |
| FP-DR-04 | Band per 12 ft, kg/m derived | As a planner, I always see kg per 12 ft, and kg/m only as a calculated chip, so two units cannot disagree. | Built prod (grams per 12 ft). c2 labels say kg/12 ft. No kg/m chip. | Now | FP-DR-03 | `/preview/die-room/card` | **Built.** kgPerMetre in get/list; copy-card, print-card |
| FP-DR-05 | Current weight from the latest reading | As the office, the weight I bill and plan from is the last drift reading, not the trial weight and not the band start. | c2 server only (`dieInstance.list` latest milli). Nothing in orders or pack reads it. | Now | FP-OP order lines; pack chip is FP-PK-03 | `/preview/die-room/card` | **Built.** latest reading in dieInstance.list; board |
| FP-DR-06 | Percent drift, green / amber / red | As the die room, I see how far the latest reading sits above the band start, in the plant's colours, and I still see whether it is inside the band. | c2 server only (`in` / `above` / `below`, gram delta). No percent, no colour, no setting. | Now | `company.updateSettings` | `/preview/die-room` | **Built.** driftTone + company.updateSettings driftGreen/AmberMaxBp (PF2); settings thresholds-card, drift-chips |
| FP-DR-07 | Die card | As the die room, I open a copy and see its picture, drawings, cavities, bolster, wall, trial weight, HV, life, and the latest reading. | c2 server only (`dieInstance.get`: supplier, trial, HV, life, FTR, notes, readings, nitriding, tiers). No image, cavities, bolster, or files. | Now | FP-DR-01 | `/preview/die-room/card` | **Built.** maker_die_no/project_no (0028/0029); copy-card, A4 print-card |
| FP-DR-08 | Run history from press runs | As the die room, I see every load of this copy — kg in, kg out, recovery, speed, remarks — without typing a second log. | c2 server only (readings may store a free-text `press_run_id`). No `press_run` table. Planned P16 / PL-W4. | Now (contract) / Next (rows, once press runs exist) | FP-PR press-run close; PL-W4 | `/preview/die-room/card` | **Built.** dieInstance.runs reads logged runs, recoveryBp, accumulated; card-runs |
| FP-DR-09 | Nitriding log | As the die room, I record a treatment with HV and chemical open / used / close, and the copy shows as out for nitriding. | c2 server only (log and mass-balance check, tested). No UI. Store link unused. Status is not flipped by the log. Planned PL-W5. | Now | PL-7 store (optional link) | `/preview/die-room/card` | **Built.** nitridingOut/Back; close = open - used enforced; card-nitriding |
| FP-DR-10 | Tier change and band lift | As the die room, I propose a new tier, or lift a worn copy onto the next band, and a manager approves. The oblique code does not change. The old band shows the copy has left. | c2 server only (`proposeTier`, approval kind `die_rerank`). Rank only. No band move. | Now | FP-DR-03 | `/preview/die-room/lift` | **Built.** proposeTier + applier dieRerank; card-tier, lift, /approvals |
| FP-DR-11 | Die maker send and receive | As the die room, I send a copy out for trial or correction and book it back, with dates and the maker. | c2 server only (`supplier` free text). No maker, no trip log. `vendor` is scrap, not this. | Next | FP-DR-16 (cannot issue while out) | `/preview/die-room/maker` | **Built.** dieMaker.*, maker send/receive/cancel; /dies/makers, card-maker |
| FP-DR-12 | Customer-owned die | As the planner, I cannot put Bhavesh's die on Anshu's job. The block is in planning, pack, press, and dispatch — not only in a customer login. | Absent. `customer` has no link to `die` or `die_instance`. | Now | FP-OP, FP-PR, FP-PK consume the rule; columns are this spec | `/preview/die-room` | **Built.** lib/dieOwner.ts; override request/close/ownerCheck; issues-page exceptions |
| FP-DR-13 | Press drawing | As the press operator, I open the section PDF from the console and check it is the same die. | Absent. No file column. A drawing-URL field on an unmerged branch is not this design. | Now | FP-PR renders the button; key and upload are this spec | `/preview/die-room/card` | **Built.** dieFile signed PUT + commit (R2 DIE_FILES); card-files |
| FP-DR-14 | Alloy and temper defaults | As the die room, I set 6063 T6 on the section once. New orders and press runs take it unless someone overrides. | Absent. No alloy or temper column. | Now | FP-OP line override; FP-PR snapshots onto the run | `/preview/die-room/card` | **Built.** die.create/update alloy+temper; defaults; die-form (datalist) |
| FP-DR-15 | Run the lightest in-band copy first | As the supervisor, the section page tells me which available copy is lightest and still inside the band. | c2 server only (`drift.suggestFirst`, tested). No screen. | Now | FP-DR-03, FP-DR-06 | `/preview/die-room` | **Built.** suggestFirst; section-detail |
| FP-DR-16 | Issue a copy to a press line | As the die room, I issue 12170-1 to a press line. The press cannot start that copy until the issue is open, and I take it back when the run is finished. | Absent. `in_use` is a free status on `update`. `press.run` has no caller. | Now | FP-PR press line id and start lock | `/preview/press` (lock banner; issue itself is the die-room action) | **Built.** dieIssue.issue/return/cancel; pressRunId required (D13); /dies/issues (the review fixes of W2-FIXES-A are merged) |

## Orders and planning — FP-OP

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-OP-01 | Sales order against the customer PO | As office, I book a party's PO as a sales order so every kg still owed stays on that PO. | Planned PL-8. Prod and c2 have a free-text PO on the bundle only. | Now | PL-8 | `/preview/orders` | **Built.** orders.create/update/confirm; /orders, /new, /$id |
| FP-OP-02 | Line: die, copy or tier, alloy and temper, cut length | As office, I put each length on its own line, name the die, optionally pin a copy or a tier, and override alloy and temper. | Planned PL-8 (section, cut length, pcs, kg, finish text). No copy, no alloy. | Now | FP-OP-01, die copy (c2) | `/preview/orders/new` | **Built.** orderLineInput (copy/tier/alloy/temper/cut); lines-editor |
| FP-OP-03 | Pieces and kg, either way | As office, I type pieces or kg and the other fills in, including pieces from a kg the party wrote on the PO. | New | Now | FP-OP-02, FP-OP-04 | `/preview/orders/new` | **Built.** orders.quote/quoteMany (no client sums); live quote |
| FP-OP-04 | Weight basis | As office, I see kg at the copy's current weight and at band start, and I can lock the line to either. | New. Latest kg/12 ft per copy is c2 server only. | Now | FP-OP-02, die weight readings (c2) | `/preview/orders/new` | **Built.** weight basis, repriceWeight; detail |
| FP-OP-05 | Baki in kg and pcs | As office, I see ordered, planned, pressed, aged, packed, in stock, dispatched and balance, and balance never goes below zero. | Planned PL-8 (ordered, produced, dispatched, baki). | Now | FP-OP-01, PL-8, PL-9, ageing, pack, dispatch | `/preview/orders/SO-12` | **Built.** orders.balance/strip; pressed now from logged runs; baki-strip (the review fixes of W2-FIXES-A are merged) |
| FP-OP-06 | Order timeline | As the owner, I open one sales order and see when it was booked, confirmed, planned, pressed, aged, packed, dispatched and moved. | New. Analytics has dispatch history only. | Next | FP-OP-05 | `/preview/orders/SO-12` | **Built.** orders.timeline; timeline (the review fixes of W2-FIXES-A are merged) |
| FP-OP-07 | Leftover stays on the PO | As office, after a part load I still see the remaining kg and pcs on that PO, in stock, for the next vehicle. | Partial. Leftover bundles stay `available` with a PO string. No order to hang them on. | Now | FP-OP-01, FP-OP-05 | `/preview/orders/SO-12` | **Built.** close/cancel with baki reason; close sheet |
| FP-OP-08 | Reallocate to another sales order | As office, I move leftover bundles to another party's sales order, and the move is recorded. | New | Now | FP-OP-07, PL-8 line link | `/preview/floor/stock` | **Built.** orders.reallocate + reallocateDecision; reallocate-sheet (the review fixes of W2-FIXES-A are merged) |
| FP-OP-09 | Plant stock | As office, I can hold material no party wants as plant stock, without inventing a customer. | New | Now | FP-OP-08 | `/preview/floor/stock` | **Built.** orders.plantStock; take-stock-sheet, stock filter |
| FP-OP-10 | Ready-stock prompt | As office, when a new line matches die and length already in the yard, I am offered those bundles before I plan more. | New | Now | FP-OP-08, FP-OP-09 | `/preview/orders/new` | **Built.** orders.matchStock; stock-sheet |
| FP-OP-11 | Press plan grouped by die | As the planner, I pick open lines and see them grouped by die across customers, so one die change serves every party that needs it. | New. No plan table. | Next | FP-OP-05, FP-OP-07 | `/preview/orders/plan` | **Built.** plans.create/candidates/update/get/list/cancel/close; /orders/plan, /plan/$id |
| FP-OP-12 | Shift window and priority | As the planner, I choose which dies go to the press for the next 24 hours and put them in order, including an urgent flag. | New | Next | FP-OP-11 | `/preview/orders/plan` | **Built.** window <= 24 h, urgent; plan-board |
| FP-OP-13 | Hand off to the press | As the press operator, I start from a released plan and do not retype the die, the lengths or the parties. | Planned PL-9 starts a typed run. No plan. | Next | FP-OP-12, PL-9, FP-PR | `/preview/orders/plan` | **Built.** plans.release queues press_run per die (<=100 params); plan-detail |
| FP-OP-14 | Price on the line, value on dispatch | As office, I can record ₹/kg on a line when the company wants it, and see the value of a dispatch. | New. ₹/kg exists only on scrap lots. | Next | FP-OP-01, dispatch complete | `/preview/platform/settings` | **Built.** `dispatch.getDispatch.value` from order-line rates (only with `order.price` and `priceOnSalesOrder`), value card on the dispatch |
| FP-OP-15 | Other party's open lines on the same die | As the planner, when I release one party's urgent lines, I am shown which of those dies also sit on another open PO, with that party's balance. | New | Next | FP-OP-12 | `/preview/orders/plan` | **Built.** plans.openLinesForDies + warnings; other-lines |
| FP-OP-16 | Customer-owned die stays with that party | As the planner, I cannot put a customer-owned die on another party's plan unless a manager has allowed that copy and that customer. | New. No owner on the die or the copy. | Next | FP-DR owner columns, FP-OP-12 | `/preview/orders/plan` | **Built.** owner gate in plans.create/update/release; owner flag on lines |
| FP-OP-17 | Hold stock against a line | As office, I link a chosen set of available bundles to an open line so they stay in the yard but belong to that PO. | Partial. Dispatch can hold bundles already on that dispatch. It cannot hold an arbitrary set from stock onto a party. | Next | FP-OP-08, FP-OP-09 | `/preview/floor/stock` | **Built.** orders.hold/release/holds; held_for_order scan refusal; components/hold-sheet (order detail) |
| FP-OP-18 | Orders running late | As the owner, Today shows lines with balance whose order date is older than 15 days. | Planned PL-11 | Next | FP-OP-05, PL-11 | `/preview/platform` | **Built.** orders.late (Q7 expected date); late chip |
| FP-OP-19 | Print and export | As office, I print the sales order and the shift die list, and export the order book. | New. The documents package prints packing lists. | Next | FP-OP-01, FP-OP-12 | `/preview/orders/plan` | **Built.** order sheet, shift die list and order book export (`@orrn/documents` order-sheet), print + Excel on order, plan and book |

## Press — FP-PR

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-PR-01 | Press lines | As a manager I record each press so a queue and a run belong to a line. | New. Onboarding asks for a count; digest assumes one press. | Now | `masters.publish` | `/preview/press` | **Built.** press.lines list/create/update/retire/restore; /press/lines (lines-master) |
| FP-PR-02 | Queue per line | As the press I see only the jobs my line was given, in the order the planner released. | New. PL-8 is orders and baki, not a release. | Now | FP-OP `plans.release`, PL-8 | `/preview/press` | **Built.** press.queue.list; queue-view, job-card; filters section/SO/copy |
| FP-PR-03 | Press station | As the operator I run the shift from one large-type screen on an 11" tablet at the press. | Planned PL-W4 / PL-N4. No route. | Now | FP-PR-05 | `/preview/press/console` | **Built.** pressRun.get/open; /press/runs/$id station |
| FP-PR-04 | Die-issue gate | As the die room I issue a copy to a line. The press cannot start until that issue is open. | Absent. PL-9 start sets the copy `in_use` with no issue. | Now | FP-DR `die.issue` | `/preview/press/console` | **Built.** pressRun.start refuses if die not issued; station lock |
| FP-PR-05 | Run state machine | As a supervisor I see a run move only forward, and I can see which step it is on. | Planned PL-9 as start / die-out / finish. QC is not a gate. | Now | FP-PR-04 | `/preview/press/console` | **Built.** start/stop/resume/undoStart/count/close/void/reopen; station |
| FP-PR-06 | Server-time start and stop | As the owner I trust the running minutes. | Planned die in/out timestamps (PL-9). | Now | FP-PR-05 | `/preview/press/console` | **Built.** server time; skew > 2 min -> press_time; station |
| FP-PR-07 | Billets by cast and length | As the operator I record which cast and which billet length went in. | Planned as one count and one kg on the run's cast (PL-9). Length is not a column. | Now | PL-5 cast, FP-FD billet stock | `/preview/press/console` | **Built.** pressRun.billets, D22 weighed input; station-count |
| FP-PR-08 | Pieces by cut length | As the operator I enter pieces and weighed kg for each cut length after the stop. | Planned `press_run_line` (PL-9). | Now | FP-PR-05, FP-AG | `/preview/press/console` | **Built.** pressRun.lines (plan line required); station-count |
| FP-PR-09 | Rejects with reason codes | As the operator I record reject kg against a reason, or I record that QC found none. | Planned `qc_entry` (PL-9), not a gate on the run. | Now | `reason_code` (PL-9), FP-PR-05 | `/preview/press/console` | **Built.** pressRun.qc (reason kind qc_reject); station-count |
| FP-PR-10 | Butt and ends | As the operator I weigh the butt and the cut ends. | Planned `discard_g` and `ends_g` (P16). Digest glosses discard as the butt. | Now | Plant Scrap stream, FP-PR-11 | `/preview/press/console` | **Built.** pressRun.scrap (DISCARD / PLANT-SCRAP); station |
| FP-PR-11 | Server-computed recovery | As the owner I see a recovery the tablet cannot overwrite. | Planned as a number `finish` computes (PL-9). No table, so nothing rejects a client-sent percentage. | Now | FP-PR-07, FP-PR-08 | `/preview/press/report` | **Built.** closeGates/closeFigures server side; 24 gate codes; station gates |
| FP-PR-12 | Downtime with reason codes | As the operator I start and stop a stoppage and pick a reason. | Planned `press_downtime` (PL-9). The code list itself is unspecified. | Now | `reason_code` | `/preview/press/console` | **Built.** press.downtime start/stop; station |
| FP-PR-13 | Operator, relief, and shift | As a supervisor I see who started, who took over, and which shift, without the timer resetting when the press man changes. | Planned operator and supervisor (PL-9). No relief. Shift names are a setting. | Now | Platform shifts setting (FP-PF-05) | `/preview/press/console` | **Built.** pressRun.handover; station |
| FP-PR-14 | Drawing at the press | As the operator I open the section drawing to confirm the copy and read the dimensions. | Absent. No drawing on the section. | Now | FP-DR `die.drawing_key` | `/preview/press/console` | **Built.** pressRun.drawing; station button |
| FP-PR-15 | Remarks on the die card | As the die room I read the press remark and the operator remark on that load, beside the drift reading. | c2 server only: unbound `press_run_id`, no remark columns. | Now | FP-DR card, FP-PR-05 | `/preview/die-room/card` | **Built.** pressRun.remark/byCopy; station, die card |
| FP-PR-16 | Pressed on the sales order | As the office I see pressed kg and pieces on the order as soon as the run logs. Baki does not move. | Planned PL-8: produced = bundles, baki = ordered − dispatched. No press link. | Now | PL-8, FP-OP | `/preview/orders/SO-12` | **Built.** run lines bind plan line; strip pressed; order strip |
| FP-PR-17 | Press report | As a manager I print a landscape report of logged runs, 17 columns, for a date range. | Planned PL-11 `reports.production`. | Now | FP-PR-11, PL-11 | `/preview/press/report` | **Built.** press.report 17 cols + csv; /press/report |
| FP-PR-18 | Daily press summary | As the owner I read yesterday's kg, recovery and stops on Today and on one printable page. | Planned PL-11 `pressedToday` and P19's 7 am page. | Now | FP-PR-17, platform shift 1 | `/preview/press/summary` | **Built.** press.summary; pressedToday, lateShareBp; /press/summary, Today tile |
| FP-PR-19 | Offline-tolerant entry | As the operator I keep moving a run when the link drops. The server still owns the times when the outbox lands. | New behaviour. `mutation` exists and is unused. LAN-first offline is out of the plant-modules phase. | Next | FP-PR-06, `mutation` | `/preview/press/console` | **Built.** offline outbox for the station (per-plant localStorage, same `clientMutationId` on resend), unsent-count banner |
| FP-PR-20 | Override approvals | As a manager I approve a disputed time or a reopen. A short billet book is a written reason, not a negative stock row. I cannot approve my own request. | c2 server approvals exist for other kinds. PL-9 names a supervisor override for negative billets and no approval kind. | Now | PL-1 `approval`, FP-FD | `/preview/press/console` | **Built.** appliers press_time/reopen/late_entry; approvals sheet |
| FP-PR-21 | Press data collector | As the plant I have a cabin device read the PLC and post billet rows beside the typed run. | Planned Phase 7, explicitly not in this phase. Read-only. | Later | OI-01, OI-05, FP-PR-07 | — | **Built.** simulator only: `POST /collector/press/frames` (node-signed), `press.collector.*`, migration 0033; the PLC is never written and real bring-up is owner-only (Q46) |
| FP-PR-22 | Threshold alerts | As a supervisor I am told when container temperature, billet temperature or pressure leaves its band. Continuing needs a reason. | Absent. | Later | FP-PR-21 | — | **Built (H).** `press.collector.thresholds` / `alerts`, Today alerts chip; list and acknowledge at `/press/alerts`, limits in Settings > Standards (Collectors card). Simulator `--press-sim`; PLC is Q46. |

## Foundry — FP-FD

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-FD-01 | Furnace master | As a manager I keep each furnace (code, name, capacity, billet diameter) so a melt names the furnace it ran on. | New | Now | `masters.publish` | `/preview/foundry` | **Built.** `foundry.furnaces.*`, `/masters/furnaces`, F1 seeded (0036). |
| FP-FD-02 | Open a cast | As foundry I open a cast and get the next plant number (`K31`), or continue a number already written in the book, with the date and the alloy we are aiming at. | c2 server only (`formatCastCode`, doc type `cast`, `cast.enter`; no table). Planned PL-5. | Now | PL-2 (built), FP-FD-09 | `/preview/foundry` | **Built.** `casts.open/list/get`, `/casts`, `/casts/new`, `/casts/$id`, phone Cast tab; Settings > Standards continues the cast book (`castSeriesStart`); legacy paper codes are unique per plant (0042), and generated cast/bundle identifier formats are refused before sequence allocation. Shared parsers keep trace routing unambiguous. |
| FP-FD-03 | Record a melt | As foundry I add a melt under an open cast: furnace, book date, alloy target, and the five times on the sheet, including start and end. | Planned PL-5 (timestamps, no furnace). | Now | FP-FD-01, FP-FD-02 | `/preview/foundry/cast` | **Built.** `melts.save/preview/lock/discard`, the melt stepper on web and phone. |
| FP-FD-04 | Charge scrap lots | As foundry I draw kg from OK kanta lots into the melt, and see what each lot still has. | c2 server only for the lots. The draw is Planned PL-5. | Now | PL-6 (c2 server), FP-FD-03 | `/preview/foundry/cast` | **Built.** `lots.available`, Charge step. |
| FP-FD-05 | Charge return streams | As foundry I charge ingot, plant scrap, discard, dross ingot, bend log, hill metal, pit, tendis or dross metal back into a melt. | Planned PL-5 (`return_stream` not created). | Now | FP-FD-03 | `/preview/foundry/cast` | **Built.** `returnStreams.*` with balance guard and opening balance, `/foundry/stock`. |
| FP-FD-06 | Draw store items | As foundry I issue cover flux, other chemicals and LDO from the central store onto the melt, and I still write the tank's LDO inches. | c2 server only (`prepareStoreDraws`, purpose `melt`). Planned P15 / P17. | Now | PL-7 (c2 server), FP-FD-03 | `/preview/foundry/cast` | **Built.** Store chemicals draw as MRS at lock; LDO dips (web; not editable on the phone, BL 77). |
| FP-FD-07 | Log and billet output | As foundry I record each stick that left the caster: piece count, log length, billet length, and weighed kg. | Planned PL-5 (one logs blob). | Now | FP-FD-03 | `/preview/foundry/cast` | **Built.** Output logs post BILLET at lock. |
| FP-FD-08 | Dross, iron, burn loss, yield | As foundry I record dross and iron, and I see burn loss and yield before I lock. Outside 3% I must write a reason. | Planned PL-5 / P15. Showcase copy only. | Now | FP-FD-04, FP-FD-05, FP-FD-07 | `/preview/foundry/cast` | **Built.** `meltBalance`, 3 % rule, balance note. |
| FP-FD-09 | Alloy limits | As a manager I set, per alloy, the min and max for Si, Fe, Cu, Mn, Mg, Zn, Ti, Cr and Al. | New. Planned spectro values are an untyped map. | Now | `masters.publish` | `/preview/foundry/cast` | **Built.** `foundry.alloys.*`, `/masters/alloys`, 6063 and 6061 seeded. |
| FP-FD-10 | Spectro reading and pass/fail | As foundry I enter the nine elements for a melt and see pass, fail or incomplete against the alloy, including aluminium as typed or as the balance. | Planned PL-5 (parsed key/values, no verdict). | Now | FP-FD-09, FP-FD-03 | `/preview/foundry/cast` | **Built.** Verdict against alloy limits; deciding spectro result = latest live one with numbers. |
| FP-FD-11 | Spectro file now | As foundry I attach the spectro PDF or a photo of the printout to the melt. The numbers I type are the record; the file is the evidence. | Planned PL-5 / Q-P7. | Now | FP-FD-10 | `/preview/foundry/cast` | **Built.** `spectro.attach` file up to 1 MB, phone photo; View file on web melt, trace and certificate opens `spectro.file` bytes from D1. Native links to the web; real camera capture remains a device check. |
| FP-FD-12 | Spectro from the collector | As the plant, the spectrometer PC drops a results file and the reading attaches itself to the melt. | Planned as out (Q-P7, OI-02). | Next | FP-FD-11, plant collector (not this phase) | — | **Built (H).** Collector ingest, `/casts/inbox`, simulator; real spectrometer is Q47. |
| FP-FD-13 | Lock a melt | As foundry I lock a melt. Stock moves then, and the charge and the outputs cannot be edited. | Planned PL-5 (posts on create, no lock state). | Now | FP-FD-04 through FP-FD-08, FP-FD-10 | `/preview/foundry/cast` | **Built.** `melts.lock` gates, ledger + MRS in one batch, correction by approval. |
| FP-FD-14 | Close a cast | As a supervisor I close a cast. If the tail is outside 3%, a second person approves, and I cannot approve my own request. | c2 server only (`cast.close`, kind `cast_close`, no applier). Planned PL-5. | Now | FP-FD-13, approval applier | `/preview/foundry/cast` | **Built.** `casts.close` on a physical billet count (Q59-A), `closePreview`, 3 % to `cast_close` approval. |
| FP-FD-15 | Billet stock by cast and alloy | As foundry or the press I see logs produced, kg still in the billet store, and kg already credited to press runs, per cast and per alloy. | c2 server only (location `BILLET`, kind `billet`, never posted). | Now | FP-FD-13. Press consumption: FP-PR | `/preview/foundry/stock` | **Built.** BILLET ledger, `stock.billets`, `/foundry/stock`, phone Billet stock. |
| FP-FD-16 | Cast number on the label | As a packer I cannot pack a new bundle without a cast, and the label prints that number. | c2 server only (`bundle.cast_id` unenforced; label variables omit cast). | Now | FP-FD-02, pack (FP-PK), spool template | `/preview/foundry/certificate` | **Built.** `bundle.createReceipt` takes `castId`, `receiptCast` counts locked melts only, pack cast picker; a cast is opened from `/casts/new` or the phone. |
| FP-FD-17 | Cast traceability | As a manager I open one cast, or one bundle, and see lots in, spectro, billets, press runs, bundles and customers. | Planned (digest §8.7). No report. | Next | FP-FD-13, FP-FD-16, FP-PR, FP-AG | `/preview/foundry/cast` | **Built.** `casts.trace`, `casts.traceBundle`, trace tab. |
| FP-FD-18 | Test certificate | As office I print a test certificate for a cast: number, alloy, furnace, melts, spectro pass/fail, and the bundles that cite it. | New | Next | FP-FD-10, FP-FD-16 | `/preview/foundry/certificate` | **Built.** `/casts/$id/certificate` staff copy; customer certificate cites the same chemistry. |
| FP-FD-19 | Foundry yield report | As a manager I read, for a month, kg in by stream, logs out, dross, iron, burn %, and LDO inches per tonne. | Planned (`reports.foundryYield`). | Next | FP-FD-08, FP-FD-06, `reports.read` | — | **Built.** `/reports/foundry-yield` by day, alloy or furnace; `byStream` source table plus lots/return-stream kg in CSV, locked melts only. |
| FP-FD-20 | Casting cost hook | As a manager I can later see what the charge cost, from lot rates already stored, without a finance module. | New. Purchase stores `rate_paise`; nothing prices a melt. | Later | FP-FD-04, PL-6 rates | — | **Built.** `casts.cost` card for purchase readers. |

## Ageing — FP-AG

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-AG-01 | Ageing oven master | As a manager I can name each oven, its capacity, and whether it is in service, so a cycle cannot start on a dead oven. | New | Next | `masters.draft`, `masters.publish` | `/preview/ageing` | **Built.** `ageing.ovens.*`, `/masters/ovens`, oven cards on `/ageing`. |
| FP-AG-02 | Trolley master | As the ageing operator I pick the painted rack number, and tomorrow the same rack can take a new load. | New | Next | FP-AG-01 | `/preview/ageing` | **Built.** `ageing.trolleys.*`, `/masters/trolleys`. |
| FP-AG-03 | Cycle recipe | As a manager I publish the temperature, soak, and hardness band for each alloy and temper, so the floor does not invent the cycle. | New | Next | `masters.publish`; cast alloy from FP-FD | `/preview/ageing/batch` | **Built.** `ageing.recipes.*`, `/masters/recipes`, recipe copied at Start. |
| FP-AG-04 | Load a trolley from press-run lines | As the ageing operator I put logged cut lengths onto a trolley — die copy, cut length, pieces, sales order, cast — without retyping them. | Planned PL-9 (row has cast, die, pcs, kg, optional PO text; no press-run link). | Next | FP-AG-02, FP-PR (PL-9 logged runs), FP-OP for the optional sales-order line | `/preview/ageing/batch` | **Built.** `ageing.batches.load`, `/ageing/load`, phone Load trolley. |
| FP-AG-05 | Ageing batch | As the ageing operator I start a cycle on an oven with a recipe, a shift, a gas-meter start, and an in-time, and I take it out with a gas end and an out-time. | Planned PL-9 (`ageing.create` one-shot; `ageing.enter` key exists, no table). | Next | FP-AG-01, FP-AG-03, FP-AG-04, PL-9 | `/preview/ageing` | **Built.** Start, readings, Take out; `/ageing/batch/$id` stage stepper. |
| FP-AG-06 | Temperature log | As the ageing operator I record soak temperatures as the cycle runs, and I can see whether the oven held the recipe. | New (PL-9 has one `tempC`). | Next | FP-AG-05 | `/preview/ageing/batch` | **Built.** Typed, collector and simulated readings against the recipe band; soak verdict (15 min per reading). |
| FP-AG-07 | Product hardness | As the ageing operator I record Webster or Brinell samples per line, and the batch cannot release a line that fails the temper. | Planned PL-9 (optional hardness on the row; unit not specified). | Next | FP-AG-03, FP-AG-05 | `/preview/ageing/batch` | **Built.** Hardness sheet, median, retest of a held line. |
| FP-AG-08 | Release to pack | As the ageing operator I release lines that passed, so pack sees only metal that finished the cycle. | New | Next | FP-AG-07, FP-PK pack source | `/preview/ageing/batch` | **Built.** Release (what passed is released, the rest held with a reason); override by approval. |
| FP-AG-09 | Remaining pieces | As a packer I take pieces off a released line, and the trolley shows what is left. Voiding the bundle puts the pieces back. | New | Next | FP-AG-08, `bundle.pack` | `/preview/ageing/batch` | **Built.** Pack draws pieces from released rows only (`bundle.ageing_row_id`). |
| FP-AG-10 | Ageing report | As the office I print or export a cycle: batch, oven, trolley, press run, sales order, customer PO, cast, pieces, hardness, pass or fail. | New (PL-11 `reports.production` does not name ageing). | Next | FP-AG-05, PL-11 | `/preview/ageing/report` | **Built.** `/ageing/history`, `/reports/ageing` with CSV. |
| FP-AG-11 | Holds | As the ageing operator I hold a line or a whole trolley — soft hardness, surface, customer — so pack cannot take it. | New | Next | FP-AG-05, reason-code master | `/preview/ageing` | **Built.** Hold and clear a line or the trolley. |
| FP-AG-12 | Rework | As a supervisor I send held pieces back for another cycle, on the same or another trolley, without losing the first cycle's record. | New | Next | FP-AG-11, FP-AG-03 | `/preview/ageing/batch` | **Built.** Age again (rework), discard the rest, split, void rules. |
| FP-AG-13 | Trace onto the bundle | As anyone with the bundle I can see the ageing batch, the press run, and the cast the pieces came from. | Planned columns only (`bundle.cast_id` unenforced). | Next | FP-AG-09, FP-FD, FP-PR | `/preview/ageing/report` | **Built.** Bundle page Aged badge and batch link; void writes pieces off once the batch is closed (Q60-A). |
| FP-AG-14 | Override a short soak or a fail | As a manager I can approve a release the recipe would block, and the approval is a second person. | New (approval kinds exist; this kind does not). | Next | `approval.decide` | `/preview/ageing/batch` | **Built.** `ageing_override` approval with the figures in the sheet. |
| FP-AG-15 | Pieces in ageing on the order | As the office I open a sales order and see pieces loaded, in the oven, held, released, packed, and still on the trolley, per line. | New | Next | FP-AG-04, FP-OP | `/preview/ageing/report` | **Built.** Order strip Aged kg cell (`agedG`) and per-line `ageing.forOrder` chips: loaded, in oven, out to test, held, released, packed, and authoritative remaining pieces including zero after scrap/rework. |
| FP-AG-16 | Native ageing station | As the operator on the QC and ageing phone I load, start, log a temperature, record hardness, and release, with the same rules as the web. | Planned PL-N4 | Later | FP-AG-05, PL-N4 | — | **Built.** Phone: More, Ageing (board, batch, load); age again, discard and void are web-only. |
| FP-AG-17 | Collector temperature | As the plant I can have an edge device post the same temperature rows the operator types, marked `telemetry`. | Planned as typed-first (P2). Machine table is digest-only. | Later | FP-AG-06, digest Machine | — | **Built (H).** `POST /collector/ageing/readings`, `OVEN_SIMULATOR`; no plant oven sensor yet. |

## Pack, stock and dispatch — FP-PK

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-PK-01 | Pack from an ageing trolley | As a packer, I pick a trolley line and the sales order, die and cut length are already filled, then I enter pieces and weight and print the label. | New. Prod pack is a typed receipt. c2 `/pack` is a stub. | Now | FP-AG `ageing_row`; FP-OP sales order line; PL-3 ledger | `/preview/floor` | **Built.** bundle.createReceipt: SO line, copy, cast, source, rejects, replay key; /pack/new 3 steps |
| FP-PK-02 | Scale weight through orrn-spool | As a packer, I enter pieces only. The stable scale reading becomes the bundle kg. If I type a weight, I give a reason. | New. Every weight in ORRN is typed. Spool has no scale driver. | Now | orrn-spool; FP-PK-01 | `/preview/floor` | **Built.** scale.reading, spool client, simulator; scale-view (polls scale.reading) |
| FP-PK-03 | Live kg/12 ft and drift | As a packer, I see kg per 12 ft and whether it sits in the die's band before I print. | c2 server only. `kgPer12ftMilli` stored at pack from typed weight. No screen. | Now | Section band (built); FP-DR drift reading | `/preview/floor` | **Built.** previewLine tone, D15 bundleBand; verdict chip, percent |
| FP-PK-04 | Label with QR, cast, sales order, standard | As a packer, the label shows bundle number, die, length, pieces, kg, cast, sales order, and the BIS standard plus CM/L for hollow or solid. The QR opens the bundle. | Partial. Prod prints a label after save. Variables omit cast, sales order, standard, licence. | Now | FP-PF `settings.standards`; FP-FD cast code; FP-PK-07 | `/preview/floor` | **Built.** label vars; labelSheet; label-sheet A4 fallback |
| FP-PK-05 | Branding on or off | As a clerk, I print the label and the packing list with or without the plant logo. | New. No logo flag on the label variables or the PL snapshot. | Now | FP-PK-04; FP-PK-13 | `/preview/floor` | **Built.** showLogo snapshot; source-gate toggle |
| FP-PK-06 | Printer path | As a plant, labels print on the LAN spool we already run. A small plant without a packing computer can be evaluated for a Bluetooth printer later. | Built spool (TCP 9100, queue, retry, templates). No Bluetooth. | Later | orrn-spool | — | **Deferred (Later).** There is no Bluetooth printer at the plant (D31); the spool covers TCP 9100 and the A4 sheet is the fallback. |
| FP-PK-07 | Party bundle numbers | As office, I set each customer to restart bundle numbers monthly, on 1 April, or never. | c2 server only, company-level. Prod is `BG-` only. | Now | PL-2 `doc_series` | `/preview/floor/list` | **Built.** doc_series party scope; customer.bundleNumberPolicy; customers bundle-numbers-card |
| FP-PK-08 | Stock by die, length and bundle | As office, I see in-stock kg and pieces by die and cut length, and open the bundles. | Built prod, by die only. c2 stock routes are stubs. | Now | PL-3; FP-PK-01 | `/preview/floor/stock` | **Built.** stock.byDieLength/byYard; /stock/lengths, /stock/yards, /stock/bundles |
| FP-PK-09 | Transfer between sales orders and plant stock | As office, I move bundles from one sales order to another, or back to plant stock, and the record says who and why. | New. Hold exists only for bundles already on a dispatch. No transfer document. | Now | FP-OP; FP-PK-08 | `/preview/floor/stock` | **Built.** via orders.reallocate (D6); reallocate-sheet |
| FP-PK-10 | Customer-owned die block | As a manager, a die a customer owns cannot be packed or dispatched for anyone else unless I approve it. | New. No owner column. No pack or dispatch guard. | Now | FP-DR `owner_customer_id`, `profileKind` | `/preview/floor/dispatch` | **Built.** assertDieAllowed in pack/dispatch/scan; pack saves with pinned copy; save-error maps owner |
| FP-PK-11 | Dispatch by QR scan | As a gate clerk, I scan bundle labels onto a dispatch that already has the customer, vehicle and transporter. | Built prod, no scan screen. c2 server: `addBundlesBySerial` and hold reasons; dispatch screens are stubs. | Now | `bundleHold`; `resolve`; PL-8 header; FP-PK-04 | `/preview/floor/dispatch` | **Built.** lib/scan.ts classifier (13 outcomes); scan-sheet + scan-outcome map |
| FP-PK-12 | Vehicle capacity warning | As a gate clerk, I am warned when scanned kg passes the vehicle's capacity, and I can still go on if I say why. | New. Outbound dispatch has no capacity. | Now | FP-PK-11 | `/preview/floor/dispatch` | **Built.** transporter router, capacity + override reason; capacity-banner, transport-fields |
| FP-PK-13 | Packing list v2 | As a clerk, I send a section-sorted list with a line per bundle, a hollow/solid summary, optional original sales order, and I can join dispatches. A reprint keeps the copy I already sent. PDF and Excel. | Built prod, narrow. c2 regenerate deletes and renumbers. | Now | PL-2; PL-8 columns; FP-PK-05; FP-PK-07 | `/preview/floor/list` | **Built.** packingList.revisions/regenerate/combine; PL v2; packing-list-revisions, /packing-lists/$id |
| FP-PK-14 | Rejects at pack | As a packer, I set aside damaged pieces with a weight, and I can hand the pieces still on the trolley back to ageing as scrap. | New. No reject columns. Inbound scrap purchase is a different flow. | Now | FP-PK-01; FP-AG `scrap_pcs` | `/preview/floor` | **Built.** pack_reject + stock.rejections; rejects-panel |
| FP-PK-15 | Scan block | As a gate clerk, a scan tells me why a bundle cannot go on this dispatch: unknown, held, dispatched, void, wrong customer, or a die owned by someone else. | c2 server only for unknown, held, dispatched, void. No wrong-customer rule. No screen. | Now | FP-PK-10; FP-PK-11 | `/preview/floor/dispatch` | **Built.** scan refusals incl. held_for_order; scan-outcome (en/hi/gu pinned) |
| FP-PK-16 | Stock age | As a manager, I see how long bundles have sat, in the same buckets the server already computes. | c2 server only. `analytics.stockAgeing` buckets 0–15, 16–30, 31–60, 60+ days. No caller. | Later | PL-A1 | — | **Built.** `/reports/stock-age` (`analytics.stockAge`), Today "older than 90 days" tile, stock charts |

## Platform — FP-PF

| ID | Feature | User story | ORRN today | Priority | Depends on | Demo route | Status (2026-10-25) |
|---|---|---|---|---|---|---|---|
| FP-PF-01 | Party portal | As a party, I sign in and see only the dies and copies FourCubes has granted me, never another party's. | New. `customer` is a master with no login. | Next | PL-8 sales order exists to show; die-room owner columns | `/preview/platform/portal` | **Built.** portal.* (portalProcedure, party logins, misses NOT_FOUND); portalEnabled consumed; _portal layout, /portal, /dies |
| FP-PF-02 | Party places a sales order | As a party, I place a sales order for a granted die. It lands as booking. The office confirms it. I cannot set the rate. | New. No `sales_order` table on this branch (planned PL-8). | Next | FP-PF-01, PL-8, FP-PF-06 | `/preview/platform/portal` | **Built.** portal.orders.create via orders.create; /portal/orders/new |
| FP-PF-03 | Party sees baki and dispatches | As a party, I see ordered, dispatched, and baki on my sales orders, and the dispatches that carried them. | New | Next | FP-PF-01, PL-8 | `/preview/platform/portal` | **Built.** portal.orders/dispatches; /portal/orders, /dispatches |
| FP-PF-04 | Packing list and test certificate | As a party, I download the packing list and a test certificate for my completed dispatch. | New. PL PDF is generated client-side from a snapshot for staff. No test certificate. | Next | FP-PF-03, FP-PF-09, packing-list snapshot (pack spec) | `/preview/platform/portal` | **Built.** `test_certificate` with revisions, `/portal/certificate/$id`, staff "Issue test certificate"; chemistry is the cast's deciding spectro result, "pending" only for a cast with none. |
| FP-PF-05 | Named shifts and the production day | As the plant admin, I name the shifts. Shift 1's start is the production day, including overnight. | Planned. `settings.shifts` named, not in `company.updateSettings`. `dashboard.today` uses calendar midnight. | Now | None. Press and ageing store `shift_id`. | `/preview/platform` | **Built.** shifts in updateSettings; productionDay; shifts-tab |
| FP-PF-06 | Commercial switches | As the plant admin, I turn die bands, price on the sales order, and "die required" on or off. The server enforces each one. | New as flags. Band lives on `die.weightMinG` / `weightMaxG`. No sales order yet. | Now | PL-8 consumes the flags when orders land. Flags can ship first. | `/preview/platform/settings` | **Built.** commercial switches, audited; modules-tab |
| FP-PF-07 | Bought modules enforced | As platform staff, I set the modules a plant bought. Nav and server both refuse a module that is off. | Partial c2. `modules[]` hides nav, palette, and scan. Mutations ignore it. | Now | None | `/preview/platform/settings` | **Built.** moduleGate ROUTER_MODULE + APPROVAL_KIND_MODULE; modules-tab, nav |
| FP-PF-08 | Second factor stays TOTP | As a plant admin, I cannot paste an IP range that skips the second factor, and I never see a router secret on the company form. | Built prod and c2. Authenticator TOTP. No IP bypass. | Now | None. PIN itself is Later. | `/preview/platform/settings` | **Built.** TOTP as a step of the sign-in form (`/login`). |
| FP-PF-09 | BIS standard and CM/L | As the plant admin, I set the standard and CM/L for solid, hollow, and semi. Labels and certificates print the pair that matched the die's profile kind. | New. `die` has no profile kind. No standard fields in settings. | Now | Die-room `die.profileKind`. Pack spec prints the snapshot. | `/preview/platform/settings` | **Built.** company.standards per profileKind; standards-tab |
| FP-PF-10 | Users and the 13 roles | As the plant admin, I invite as many people as the plant needs, each with one of the 13 roles, and I cannot remove the last owner. | Built c2 server (13 roles, invite, last-owner guard). Prod has 5 roles. Team UI is a redirect onto a stub. | Now | PL-1 (done on c2) | — (real screen is `/settings` Team; not a preview page) | **Built.** membersList/UpdateRole/Remove; 13 roles; settings team-tab, party logins |
| FP-PF-11 | App distribution and devices | As a floor lead, I see which phones are on an old build. A build below the minimum cannot open the floor. | New. `device` rows are never written. No EAS, no `expo-updates`. One app id `in.orrn.app` already. | Now | None | `/preview/platform/devices` | **Built.** release.check/list, device.register, app_release; devices-tab, /admin/releases |
| FP-PF-12 | Backup and restore drill | As the owner, I see when yesterday's data was copied and when a restore into a scratch plant last succeeded. | Absent. Plant-modules §8 deferred anything beyond D1 Time Travel. | Now | None | `/preview/platform/settings` | **Built.** backup_run, cron 21:30 UTC; backup-tab, /admin/backups, docs/RESTORE_DRILL.md |
| FP-PF-13 | Gujarati | As a packer, I use the floor in Gujarati, with die, cast, PL, kanta, and baki left in the plant's words. | Partial c2. `en` + `hi` with parity tests. No `gu`. Prod has no i18n. | Now | None | `/preview/platform` | **Built.** floor Gujarati: `GU_FLOOR_NAMESPACES` (floor, settings, approvals, die room, dies, nav, errors, status, dispatch, bundle, orders words) complete and pinned by `gu.test.ts`; office namespaces and guide texts outside the floor flows fall back to English by design; native-speaker review is open (Q48) |
| FP-PF-14 | Guides, support, release notes | As a new packer, I open the guide for this screen. As the owner, I see who to call and what changed in the last app build. | Partial c2. Guide index works; slug page is a stub. No support contact. No release notes. | Now | FP-PF-11 for the notes source | `/preview/platform/devices` | **Built.** `/guides` with 44 SOP guides in en and hi (gu for the 9 floor flows), support tab and `/admin/support`; release notes under Settings > About (`release.notes`) |
| FP-PF-15 | Today, per role | As each role, I open Today and see the production day's numbers and the one next action I am allowed to take. | c2 server only. `dashboard.today` exists. `/today` is a stub. Window is midnight, not a shift. | Now for the four KPIs and permission tiles that exist today. Station tiles appear when those modules land. | FP-PF-05 for the window. PL-11 for the printable 7 am page. | `/preview/platform` | **Built.** dashboard.today per role, 4 KPIs, production day; /today (the review fixes of W2-FIXES-A are merged) |
| FP-PF-16 | Audit viewer | As the owner, I answer who voided this bundle without asking support to read the database. | Partial. Rows written, no list API. Retention column unread. | Next | None for the viewer. Useful once pack void is on a screen. | — | **Built.** audit.list/forSubject; /audit |
| FP-PF-17 | Plant switcher | As an accountant in two plants, I switch plant from the header. Each plant keeps its own role. | c2 server only. `company.switch` and `memberships` on `auth.me`. No UI. | Next | PL-1 (done) | — | **Built.** plant switcher in the header (`company.switch`, hidden when impersonating or with one plant) |
| FP-PF-18 | Station PIN | As a packer on a shared tablet, I enter a PIN on a paired station instead of an email code. | Planned P11, explicitly deferred. Not built. | Later | P11, OI-06. Not a Now build. | — | **Deferred (Later, OI-06).** Own account on any phone is the rule (Q33). |

---

## Coverage vs Extrusion Suite

Every capability in the competitive report's §3 matrix is in this table. **Maps to** is at least one FP ID, or an ORRN capability that already exists or is already planned outside this list (PL-n, spool, prod). **Flag** is blank when mapped. `UNMAPPED` means no FP ID and no existing ORRN capability covers it. `DROPPED` means the specs considered it and refused it; it is not a build gap.

### §3.1 Platform, access, administration

| Capability | Maps to | Flag |
|---|---|---|
| Cloud web app | Existing. Built prod (Vite tenant app). c2 stubs are Wave 0, not a new feature. | |
| Android app | Existing prod Expo drawer. FP-PF-11 (distribution and minimum build). Floor stations: FP-PR-03, FP-AG-16, PL-N2. | |
| iOS / iPadOS app | Existing c2 `app.json` (`in.orrn.app`, tablet). FP-PF-11 covers the release gate. Public store listing stays out (c2 redesign §8). | |
| Shop-floor tablet console | FP-PR-03. Same shell, larger type. Not a second theme. | |
| App release management / forced update | FP-PF-11. One app id. Spool's update-check stays the print agent, not the phone. | |
| Per-client white-label builds / domains | FP-PF-11 keeps `in.orrn.app`. Per-client flavors are not adopted. | DROPPED |
| Multi-tenant isolation | Existing. Session `companyId`, foreign `x-orrn-company` rejected on c2. Not database RLS. | |
| One user, many plants | FP-PF-17. Server `company.switch` already on c2 (PL-1). | |
| Login methods | Existing. Email + password and magic link, invite tokens. Google sign-in is not adopted (platform spec). | DROPPED (Google only) |
| Second factor | FP-PF-08. Built TOTP on web and native. | |
| Network-based OTP bypass, router heartbeat | FP-PF-08 refuses an IP skip and a router secret on the company form. Floor convenience is FP-PF-18, Later. | DROPPED |
| Permissions model | FP-PF-10. Existing c2 matrix, 13 roles, one `actionProcedure` list. Prod still has 5 roles until cutover. | |
| Unlimited users | Existing. No seat cap. FP-PF-10 does not add one. Pricing stays outside this list (report G2). | |
| Platform admin, impersonation | Existing. Grant 5–480 min, default 30, audited `impersonatorId`. | |
| Audit log | FP-PF-16. Rows already written on c2. Viewer is the gap. | |
| Two-person approvals | Existing `approval` for `die_rerank` and `dc_note`. New kinds sit on the features that need them: `die_owner_override` (FP-DR-12), `cast_close` applier (FP-FD-14), `order_reallocate` (FP-OP-08), `ageing_override` (FP-AG-14), `press_time` / `press_reopen` (FP-PR-20), `dispatch_overdraw` (PL-8). | |
| Feature toggles per tenant | FP-PF-06 (die bands, price, die required) and FP-PF-07 (bought modules, server-enforced). | |
| Backups | FP-PF-12. Lifts the one plant-modules §8 line that deferred anything beyond D1 Time Travel. | |
| UI languages | FP-PF-13 (Gujarati) plus existing `en` + `hi` on c2. | |
| In-app guides | FP-PF-14. Index exists; slug page is the gap. | |
| Offline | FP-PR-19 (press outbox). Pack and scan reuse the same `mutation` table when those stations need it. Full LAN-first plant node is not an FP ID. | |
| Push notifications | Report X7 (held bundle, die over range, dispatch completed). `device.push_token` is never written. No FP ID. | UNMAPPED |
| Global search | Existing c2 command palette (dispatches, dies, customers, bundle serial). Not on prod. No new FP ID; keep it. | |
| Integration API | Existing HMAC spool and edge webhooks. Agent-tools MCP is a draft spec, not this list. | |
| Hosting resilience | Existing. Cloudflare Workers + D1. Not a feature to build. | |
| Data residency in India | Not stated (D1 created with no location hint). No FP ID. | UNMAPPED |

### §3.2 Masters: sections, dies, tooling

| Capability | Maps to | Flag |
|---|---|---|
| Section/profile master | FP-DR-01, FP-DR-03, FP-DR-14. Existing `die` table is the section. | |
| Section drawing/image | FP-DR-07, FP-DR-13. Ignore the unmerged drawing-URL branch. | |
| PDF/CDR geometry file upload and download | FP-DR-13. CDR and DWG stored and downloaded; not converted. | |
| Drawing at the press / packing station | FP-DR-13, FP-PR-14. Pack zoom reads the same `drawing_key`. | |
| Bulk import of masters | Existing. Die CSV/JSON import on prod and c2 (cap 2,000 on c2). | |
| Die identity model | FP-DR-01, FP-DR-02. Section unique on company + series + section code. Copy unique on company + section + seq. | |
| Oblique copy numbering | FP-DR-01. Code stays `{sectionCode}-{seqNo}` (hyphen). The plant's slash form is display only if the die room asks; the stored code does not change. | |
| Weight range kg per 12 ft | FP-DR-04. Existing grams per 12 ft. | |
| Current weight and % deviation | FP-DR-05, FP-DR-06. | |
| Colour bands with tolerance | FP-DR-06. Gram in/above/below stays. Percent and colour are added, not a replacement. | |
| Die usage history per run | FP-DR-08, FP-PR-15. | |
| Recovery % per run | FP-PR-11, shown on the die card by FP-DR-08. Server-computed. Not the scrap-grade `expectedRecoveryBp`. | |
| Nitriding record | FP-DR-09. Existing tested mass balance. | |
| Die hardness | FP-DR-07, FP-DR-09 (HV on the copy and the nitriding row). Product hardness is FP-AG-07 and is a different field. | |
| Die engineering fields | FP-DR-07 (cavities, bolster, backer, wall in tenths, picture). Extrusion ratio and corrector are not columns in the die-room spec. | UNMAPPED (extrusion ratio, corrector only) |
| Die status lifecycle | FP-DR-09, FP-DR-11, FP-DR-16. Status `available` / `in_use` / `at_nitriding` / `at_maker` / `retired`. `in_use` and `at_maker` are not free edits. | |
| Move a die to the next range | FP-DR-10. Same approval kind as a tier change. Code does not change. | |
| Die maker party, send/return log | FP-DR-11. Not a scrap vendor. | |
| Die allocation / issue to press | FP-DR-16, FP-PR-04. | |
| Customer-owned die locked in planning | FP-DR-12, FP-OP-16, FP-PK-10. The report marked both products Absent. | |
| Alloy / temper master, overridable per line | FP-DR-14 (text on the section, snapshotted on the line). Chemistry limits are FP-FD-09, a different master. Not one shared alloy id. | |
| Profile type (hollow/solid) | FP-DR column `profileKind` (`hollow` / `solid` / `semi`). Pack and the certificate read it (FP-PK-13, FP-PF-09). | |
| Press line master with tonnage | FP-PR-01. | |
| Customer master | Existing. Built prod (list, form, CSV). Tax id stays free text. | |
| Transporter master | Pack spec `transporter` table, used by FP-PK-11. `masters.publish` to write. | |
| Supplier/vendor master | Existing. c2 server scrap-vendor registry (PL-6). UI is PL-W2, not a new FP ID. | |
| Catalogue leads | No ORRN master and no FP ID. The buyer did not ask. | UNMAPPED |
| Shift configuration | FP-PF-05. | |
| BIS IS / CM/L numbers on stickers | FP-PF-09, snapshotted by FP-PK-04. | |
| Length units | Existing `company.updateSettings` `lengthUnit` `mm` or `inch` (c2 server). Orders display mm or ft/in from stored mm. kg/m is display-only (FP-DR-04). | |

### §3.3 Orders and planning

| Capability | Maps to | Flag |
|---|---|---|
| Customer work/sales order | FP-OP-01. Planned PL-8. | |
| Order lines (section, die, length, alloy/temper, pcs) | FP-OP-02. | |
| pcs × length → kg from die range | FP-OP-03, FP-OP-04. One formula in `@orrn/domain`. | |
| Reverse kg → pcs | FP-OP-03. | |
| Calculation from current weight | FP-OP-04, FP-DR-05. | |
| Price per kg on order; dispatch total | FP-OP-14, gated by FP-PF-06. Not a tax invoice. | |
| Order pipeline: planned / produced / stock / dispatched / balance | FP-OP-05. Balance is ordered minus dispatched, floored at zero. Pressed does not move baki (FP-PR-16). | |
| Order Excel / print | FP-OP-19. | |
| Customer PO reference | FP-OP-01. Replaces the free-text `bundle.poNumber` as the unit of truth. The string remains a snapshot on old bundles. | |
| Production planning object | FP-OP-11. Doc is a press plan, not a second "PO". | |
| Batch several orders per die across customers | FP-OP-11. | |
| Plan only the remainder | FP-OP-07, FP-OP-10, FP-OP-12 (a die already in stock is not offered as planable). | |
| Press queue: release, priority, urgent, reorder | FP-OP-12, FP-OP-13, FP-PR-02. | |
| Multi-press routing | FP-PR-01, `press_line_id` on the plan and the run. Nullable while the plant has one press. | |
| Customer self-service portal | FP-PF-01, FP-PF-02, FP-PF-03. Booking only. The plant-side lock is FP-DR-12, which the buyer asked for instead. | |

### §3.4 Press

| Capability | Maps to | Flag |
|---|---|---|
| Operator console | FP-PR-03, FP-PR-05. | |
| Start locked until the die is issued | FP-PR-04, FP-DR-16. One `die_issue` row. No second "ready" flag. | |
| Start/stop timers, server time | FP-PR-06. Offline skew is FP-PR-19 / FP-PR-20. | |
| Run log: billets, cast, input, output, butt, scrap, recovery, ram speed | FP-PR-07, FP-PR-08, FP-PR-10, FP-PR-11. Ram speed, if the 17-column report shows it, is typed until FP-PR-21. Recovery is never client-sent. | |
| Gated sequence: QC before log | FP-PR-05, FP-PR-09. QC is a step on the run, not a side document the operator can skip. | |
| Production runs report | FP-PR-17, FP-PR-18. PL-11 `reports.production` becomes this pair. | |
| PLC / press telemetry | FP-PR-21. Existing plan: read-only, never write the PLC. | |
| Threshold alerts, accountability flags | FP-PR-22 (alerts) and FP-PR-20 (accountability is an approval, not a silent flag). | |

### §3.5 Raw material and foundry

| Capability | Maps to | Flag |
|---|---|---|
| Raw material inward (ingot/scrap/alloying) | Existing PL-6 scrap lots (c2 server). No ingot or alloying receipt. FP-FD-04 draws OK lots; it does not replace purchase. | UNMAPPED (ingot and alloying receipt only) |
| Party vs factory kanta with debit-note gate | Existing PL-6, tested. Not an FP ID. ORRN is ahead; keep it. UI is PL-W2. | |
| Scrap grading A+..C, vendor rate charts | Existing grade masters (PL-6). Rate chart is not built (last lot rate only). FP-FD-20 is a later cost read, not a rate chart. | UNMAPPED (vendor rate chart) |
| Casting batch / cast number | FP-FD-02. Series already renders `K31`. | |
| Furnace data | FP-FD-01, FP-FD-03, FP-FD-06 (LDO inches), FP-FD-07. | |
| Spectro chemistry | FP-FD-09, FP-FD-10, FP-FD-11. Auto-import is FP-FD-12 (Next), not a claim that it is done. | |
| Billet stock | FP-FD-15. Location `BILLET` exists and has never been posted. | |
| Melt loss / dross balance | FP-FD-08, FP-FD-14. 3% warns and demands a reason. It never silently passes. | |

### §3.6 Ageing

| Capability | Maps to | Flag |
|---|---|---|
| Ageing oven batch: trolley, °C, start, shift | FP-AG-01, FP-AG-02, FP-AG-05, FP-AG-06. | |
| Hardness per ageing line | FP-AG-07. Die HV is not this number. | |
| Packing draws from the aged trolley | FP-AG-08, FP-AG-09, FP-PK-01. | |

### §3.7 Packing, labels, numbering, scale

| Capability | Maps to | Flag |
|---|---|---|
| Pack screen | Existing prod `/receipts/new`. c2 `/pack` is Task 20. FP-PK-01 extends it. | |
| kg/12 ft from actual weight with in-range chip | FP-PK-03. Existing server stores milli from typed weight. The chip is the gap. | |
| Reject/defect pieces at pack; scrap the rest | FP-PK-14. Calls `ageing.discardRemaining`; does not write `scrap_pcs` itself. | |
| Print on save | Existing prod print-after-save via spool. FP-PK-04 keeps that path. | |
| Printer connection | Existing spool TCP 9100. Bluetooth is FP-PK-06, Later, and does not block the LAN path. | |
| Label template design and custom fields | Existing spool (11 element types). Web printing page is a c2 stub (Task 24). | |
| AI label layout generation | Existing spool (label schema from a prompt or a reference image; does not auto-print). Not an FP ID. | |
| Print queue, retry, node heartbeat, installer | Existing spool queue, retry, Docker installer. Heartbeat is not called. Report N12: call the activate webhook. Not a new FP ID. | |
| Logo/branding toggle on label | FP-PK-05. | |
| BIS standard / CM/L on label | FP-PK-04, FP-PF-09. | |
| QR on label; scan resolves the bundle | Existing c2 `resolve` and `/b/$serial` (number and section only). FP-PK-04, FP-PK-11. Public QR stays number and section — no chemistry. | |
| Bundle serial reset policies | Existing company-level plant mode (PL-2). FP-PK-07 adds the per-party policy on the same engine. | |
| Per-party bundle numbering | FP-PK-07. Both products lack it today. | |
| Scale integration | FP-PK-02. Reader in orrn-spool. No circuit change assumed. | |

### §3.8 Stock

| Capability | Maps to | Flag |
|---|---|---|
| Bundle stock by section/die/length/order | FP-PK-08. Prod groups by die only. | |
| Append-only stock ledger | Existing PL-3 (c2 server, tested). FP-PK posts through it. Not a new ledger. | |
| Locations (yard, billet store, scrap store, store, WIP) | Existing PL-3 seed. UI is PL-W8. The oven is not a stock location (ageing spec). | |
| In-house / open stock | FP-OP-09, FP-PK-09. Plant stock is a transfer to a null line, not a customer row. | |
| Transfer bundles between orders | FP-OP-08, FP-PK-09. One `bundle_transfer` table. | |
| Hold / reserve | Existing `dispatch.reserve` (prod). FP-OP-17 is the other hold: link available bundles to a line without reserving them on a vehicle. | |
| Dead stock / stock age | FP-PK-16 on existing `analytics.stockAgeing` (PL-A1). | |
| Physical stock count | Existing plan PL-10 / PL-W8 / PL-N2. Pack spec does not redesign it. | |
| Packing rejection / scrap log | FP-PK-14 (`pack_reject`). Inbound scrap purchase stays PL-6. | |
| Cast → run → ageing → bundle traceability | FP-FD-16, FP-FD-17, FP-AG-13, FP-PR-07. | |

### §3.9 Dispatch and documents

| Capability | Maps to | Flag |
|---|---|---|
| Dispatch by bundle | Existing prod draft → reserved → completed. FP-PK-11 adds the scan screen and the vehicle header (PL-8). | |
| Block wrong or held bundle at scan | Existing c2 `bundleHold` (unknown, held, dispatched, void). FP-PK-15 adds wrong customer and owned die, on a screen. | |
| Transporter, vehicle, capacity warning | FP-PK-11, FP-PK-12. | |
| Packing list content | FP-PK-13 extends PL-8 v2. Does not drop the planned columns. | |
| Grouped / section-sorted packing list | FP-PK-13. Hollow/solid summary from `profileKind`. | |
| Packing list immutable after dispatch | FP-PK-13. Regenerate writes a new revision and keeps the sent copy. Replaces c2 delete-and-renumber. | |
| Combine dispatches on one list | FP-PK-13. | |
| Branding off on slip and label | FP-PK-05. | |
| Excel / PDF | Existing prod PDF, QR PDF, Excel. FP-PK-13 keeps both on the v2 snapshot. | |
| Proforma invoice Excel | No FP ID. Price on a dispatch (FP-OP-14) is not an invoice. | UNMAPPED |
| GST tax invoice, e-way bill | Digest in scope. Plant-modules §8 and the platform spec leave GST calls out of this phase. Unmerged invoice-number branch is not this design. | UNMAPPED |
| Accounting / Tally | Out of scope. CSV export only, as the digest already says. No FP ID. | UNMAPPED |

### §3.10 Store, analytics, AI

| Capability | Maps to | Flag |
|---|---|---|
| Central store GRN/MRS | Existing PL-7 (c2 server, tested). Foundry draws it (FP-FD-06). Nitriding may link it (FP-DR-09). UI is PL-W6, not a new FP ID. | |
| Director dashboard | FP-PF-15 (Today, per role) plus existing analytics queries (PL-A1) and the chart kit (c2 Task AN-2). Not a second home. | |
| Order/stock KPI strips | FP-OP-05, FP-PF-15. Figures come from documents, so they cannot disagree with the grid. | |
| Charts | Existing in-house SVG kit (dev page only) and PL-A1 queries. Screens land with PL-W9 / Task 19 / Task 21. No new chart library. | |
| AI features in product | Existing spool label AI. WhatsApp agent is a draft spec, not this list. No knowledge-graph feature. | |

### §3.11 Commercial and delivery

| Capability | Maps to | Flag |
|---|---|---|
| Published pricing | No product feature. Report G2. Out of the FP specs. | UNMAPPED |
| Trial offer | No product feature. Report G3 (paid pilot). Out of the FP specs. | UNMAPPED |
| Support SLA | FP-PF-14 is the in-app contact and request row. The written SLA (report G1) is commercial, not a screen in the specs. | UNMAPPED (written SLA) |
| Release cadence | FP-PF-11, FP-PF-14 (release notes). Cadence itself is how we ship, not a feature. | |
| Live reference plants | No product feature. Report G6. | UNMAPPED |
| Legacy data migration | Existing c2 resolver (`legacy_bundle_map`). The FCMS import that fills it is PL-12. Not a new FP ID. | |
| Hardware bundle (tablet, printer, scale) | Plant buys the tablet (FP-PR-03). Scale bridge is FP-PK-02 in orrn-spool. A sold hardware kit is report G4, not an FP ID. | UNMAPPED (sold kit) |

### Unmapped summary

These §3 rows have no FP ID and no existing ORRN capability that covers them. They are not silently absorbed into a nearby feature.

| Capability | Decision in the integration plan |
|---|---|
| Push notifications | Leave out of this phase. Report X7. Do not invent an FP-PF row here. |
| Data residency | Ops note. Confirm the D1 location before a buyer asks. Not a schema change. |
| Extrusion ratio and corrector on the die card | Do not add columns the die-room spec omitted. Cavities, bolster, backer, wall, picture are enough for Now. |
| Catalogue leads | Drop. |
| Ingot and alloying receipt | Drop for this phase. Scrap lots (PL-6) remain the inward path. |
| Vendor rate chart | Drop as a chart. Last lot rate stays. FP-FD-20 may read it later. |
| Proforma invoice Excel | Drop. Not a tax document. |
| GST tax invoice and e-way bill | Stay on the digest. Out of this FP phase. |
| Accounting / Tally | Stay CSV-only. Out of this FP phase. |
| Published pricing, trial offer, written SLA, reference plants, sold hardware kit | Commercial (report §9.4). Not module work. |

DROPPED rows (white-label flavors, Google login, IP OTP bypass) are mapped on purpose: the platform spec refuses them.

---

## Where ORRN goes beyond

These are capabilities the report's §3 matrix marks Absent or weaker on the competitor side, or that the seven specs add because the buyer's objections were not met.

**Stock and proof**

- Append-only kg ledger posted in the same batch as the document and the audit row (PL-3). A stock total that disagrees with the bundle rows is a failed test, not a KPI chip.
- Locations: yard, billet store, scrap store, central store. The oven is not a stock location.
- Plant stock is an owner, not a customer (FP-OP-09). No in-house party, no GST row, no leaderboard entry.
- Leftover stays on the customer PO (FP-OP-07). Reallocation is an append-only `bundle_transfer` (FP-OP-08).
- Scan names the holder: unknown, held, dispatched, void, wrong customer, owned die (FP-PK-15).
- Packing-list regenerate keeps the sent revision (FP-PK-13). The first number is not reused.
- Physical count and phantom report stay in PL-10.

**Inbound and store**

- Two kanta weights. A short factory weight cannot be marked OK without a debit note that covers it (PL-6). Heavier lots are not blocked.
- Scrap grades A+ through C.
- Central store GRN and MRS. Issue cannot go negative. Melt and nitriding can draw the same store (PL-7, FP-FD-06, FP-DR-09).
- Nine return streams, seeded, charged and received by the same master (FP-FD-05).

**Die room**

- One section code. Several bands. A second physical copy is not a duplicate. The same commercial band is (FP-DR-02, FP-DR-03).
- One stored unit: grams per 12 ft. kg/m is a chip (FP-DR-04).
- Copy code never changes on a band lift (FP-DR-10). A manager approves. The requester cannot approve their own request.
- Nitriding close must equal open minus used (FP-DR-09). Tested.
- Lightest in-band available copy is a suggestion, not an auto-issue (FP-DR-15).
- Customer-owned die is blocked in planning, pack, press, and dispatch (FP-DR-12). A portal hide is not that lock.
- Issue is the only way a copy becomes `in_use` (FP-DR-16).

**Press, foundry, ageing**

- Recovery is computed on the server from good grams and input grams, stored once. A client-sent percentage is stripped (FP-PR-11).
- A short billet book is a written reason. It never posts a negative billet row (FP-PR-20, FP-FD-15).
- Nothing is written to the PLC (FP-PR-21).
- Melt lock is when stock moves. A draft does not (FP-FD-13). Burn is computed. Outside 3% needs a reason, and a tail outside 3% needs a second person (FP-FD-08, FP-FD-14).
- Spectro pass/fail against the plant's limits, nine elements, aluminium typed or as the balance (FP-FD-10). A fail prints as fail (FP-FD-18).
- Cast number on the label, required after the first locked melt (FP-FD-16). Public QR still does not carry chemistry.
- Ageing remaining is loaded pieces minus packed, scrap, and rework, computed on the server (FP-AG-09). A short soak or a failed hardness does not release unless a second person approves (FP-AG-14).
- Rework keeps the first cycle (FP-AG-12). Pieces are not scrapped to hide a retest.

**Platform**

- TOTP stays. No IP range skips it (FP-PF-08).
- One codebase, one app id. Bought modules are refused by the server, not only hidden in the nav (FP-PF-07).
- Gujarati on the floor, with die, cast, PL, kanta, and baki left as the plant says them (FP-PF-13). Hindi already exists on c2.
- Audited impersonation, last-owner guard, 13 roles from one matrix (existing, FP-PF-10).
- Party login cannot inherit a plant role (FP-PF-01). It cannot set a rate (FP-PF-02).
- LAN print service: queue, retry, templates, label AI (existing spool). Bluetooth is optional and Later (FP-PK-06).
- Scale reading through the print agent at the packing bay, without a circuit change (FP-PK-02). A typed weight needs a reason.
- Timezone-correct document series, including per-party bundle numbers on the same engine (PL-2, FP-PK-07).
- iOS and Android from one Expo app, beside the web app (existing). Counts only once FP-PF-11 ships a build the floor can install.

**Explicitly not a beyond claim**

GST invoice, e-way bill, Tally, push notifications, a vendor rate chart, and a sold hardware kit are not in this list. Saying we have them would repeat the showcase problem the report flagged in §8.1.
