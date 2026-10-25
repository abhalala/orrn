# ORRN TODO

Open work only. History (milestones M0 to M9, the plant waves W0 to W4) is in git and in `docs/superpowers/plans/2026-10-24-orrn-fp-integration.md`; what is built, row by row, is the status column of each FP spec in `docs/superpowers/specs/`. Every item carries its backlog rank (`BL n`, from `.fp-build/BACKLOG.md`; the band is given where a rank repeats: `base` 1-29, `re-pass` 30-48, `arch` 50-57, `pl-flow` 61-70, `audit` the later 28-56 rows). FP ids (FP-XX-nn) are the rows of the specs. Keep this file in step with the work: move an item out when it is done, add one when a decision creates work.

## State

- Plant modules built end to end: die room, orders and planning, press (station, queue, report, collectors as simulators), pack, stock, dispatch from an order, packing list v2, stock count, platform (modules, shifts, thresholds, releases, backups, audit, support), customer portal, analytics and reports, Gujarati for the floor, guides in en and hi (gu for floor flows). Native has pass A to C (pack, scan, stock, dispatch, orders, dies, press role, release gate).
- Paused: the foundry web and melt lock, and the whole ageing lane (omafranky satellite, owner decision D27). Everything below under "Paused lanes" is what resuming needs.
- Nothing here has been deployed: `main` is at migration 0009. Promotion is `docs/DEPLOY_PROMOTION.md`.

## Owner only (no agent can do these)

| Item | Detail | Rank |
|---|---|---|
| Promote the FP build | Commit or stash the concepts work in `orrn/` (redesign/c2), merge `wt/FP` into `redesign/c2`, then main to dev, promote-merge to prod: the exact commands are in `docs/DEPLOY_PROMOTION.md`. Never cut over prod from `wt/FP` directly. | - |
| Infra bindings and cron | Create the R2 buckets `DIE_FILES` and `BACKUPS` (alchemy config exists, never deployed; `docs/R2_BUCKETS.md` when merged), enable the backup cron `30 21 * * *` UTC, apply D1 migrations 0000-0033+ on dev then prod (0028 refuses a DB that has melts; plants on the old 4-key module list move to all modules), run one restore drill into a scratch plant (`docs/RESTORE_DRILL.md`). | base 18, arch 53 |
| Prod email | Resend sends failed in Oct 2026; invite and reset links depend on it. Godseye shows copyable sign-in details meanwhile. Fix the sender domain before the pilot. | - |
| Native build | New development / EAS build (expo-application, expo-crypto, expo-speech added in native passes A and B); run the 9 Maestro flows on a real Android phone (`apps/native/README.md`); nothing has been run on a device. | base 5, audit 29 |
| Spool repo | Merge `fp/scale-reader` and `fp/collectors` into orrn-spool `main` (Go 1.24 toolchain; none on the Mac), install orrn-spool on the packing PC, point the node at ORRN so `/printing` shows the scale row. Web UI leftovers (webhook modals, AI designer, export, batch reprint stubs, template editor field names, CDN assets offline, audit rows) are later. | base 10, audit 45 |
| Gujarati and Hindi review | A native reader goes through `.fp-build/reports/gu-review-list.md` (native) and `gu-review-list-web.md` (12 word choices, then the full list); then flip `GUJARATI_DEFAULT_FOR_GUJARAT_PLANTS`. The Hindi list is `docs/superpowers/review/hindi-review.md`. | audit 43, 48; Q48 |
| Answer or confirm open questions | Behaviour is built to the default; confirm or change: Q1-Q4, Q6-Q11 (baki formula), Q12-Q20, Q23, Q25, Q37 (Dad has the final word on packing list scope), Q42-Q45. Q46, Q47 are hardware (below). See `.fp-build/OWNER_QUESTIONS.md`. | - |
| Real data | Import the section CSV (hyphen codes, never reuse a retired seq), legacy bundles with `legacy_bundle_map` as unassigned, `castSeriesStart` to continue the cast book, die copies from the die room, drawings attached in bulk by file name (Q18), accounts for real people (plant admin = Dad, Q32), parallel run with FCMS until the clerk signs, PO strings kept. | re-pass 39 |
| Pilot and training | Packing bay 1 week, die room desk 1 week, press tablet 2 weeks after a cast exists (integration plan). | - |
| Blume | Project registration failed on a workspace conflict (D4); delivery-level checkpoints work. | - |

## Hardware bring-up (simulators and seams are in place; nothing is faked as done)

| Device | What the owner provides | Rank |
|---|---|---|
| Packing-bay scale (FP-PK-02) | Indicator make and model, output mode (continuous ASCII over RS-232 or USB?), baud, a 30 s capture (Q5). Until then a typed weight needs a reason. | base 11 (wired), Q5 |
| TSC label printer on TCP 9100 (FP-PK-04, 06) | Label roll size and the real label template; QR `orrn.in/b/<no>?c=<slug>` is frozen (Q31). Dispatch labels on demand (Q38) are not built. | pl-flow 66 |
| Press tablet (11 inch) | Browser at `/press/runs`, own-account sign-in (Q33); the 30-minute WAN-pull test of the offline outbox. (FP-PR-19 outbox is on `wt/W4-NEXTROWS`, not merged yet.) | re-pass 31 |
| Press PLC (FP-PR-21, 22) | Make, protocol (Modbus TCP/RTU, OPC UA, S7), port, read-only client allowed, register or tag map and scaling, network path PLC to spool PC to ORRN, raw frame retention (default 90 days) (Q46). The collector stays simulated; the Modbus and OPC UA stubs refuse to start until supplied. The 2 % variance rule (Q-09) needs the owner's acceptance. | audit 46 |
| Spectrometer (FP-FD-12) | Make and software, one exported file, columns, units, decimal separator, folder or share and credentials, whether the lab writes cast numbers on samples (Q47). The watcher stays simulated; parsed values are unit-unknown. | audit 46 |
| Billet weighing cell, furnace | Cell make and output; furnace F1 = 6,000 kg is answered (Q27). | - |

## Paused lanes (omafranky satellite, D27; hardware faults, memtest86+ must pass first)

- **Foundry.** Built, unpushed, on the satellite: `wt/W2-FD-S` @28a5a83 (server: FD-01, 03, 04, 06-11, 13-15, 19; review round 1 open). Not started: FD-W web screens (`/casts`, `/casts/$id`, `/foundry/stock`, melt lock and spectro verdict screens), FD-NATIVE, FD-SEED; FD-02 and FD-05 (casts and return streams exist by API only), FD-17 cast traceability, FD-18 staff-side cast certificate (the portal certificate shows chemistry pending until verdicts exist), FD-20 casting cost hook (Later). The old PLW3 `/foundry` screens were superseded (D24); `/preview/coming-soon` stands in until the real routes exist, and the fixture components in `features/preview` can go when they do. On resume: renumber its migrations after the head (D30, 0036 onward), re-chain `prevId`, merge only after the satellite pushes into this repo. Rank: audit 55 (`castPressReturnsSql` returns 0, so a reason-free cast close is refused after any logged press run; fix before FD-15 lands).
- **Ageing.** Contracts only: `wt/W3-AG-C` @1ebdd0d (migrations 0033/0034 there, to renumber), round 2 open. Not started: AG-S server, AG-W web, AG-NATIVE, AG-SEED (AG-01..17), the trolley slice of pack (FP-PK-01), AG-15 packed share per batch, `ageing_override` applier, `bundle.ageing_row_id`, registering the reopen blocker, `agedG` on the order strip. The chain test skips the ageing step. Rank: re-pass 47.
- Resume order: satellite passes memtest86+, pushes both branches here, a merger lands foundry then ageing on top of the head, regenerates the Hindi review, reruns the chain e2e with the ageing step.

## Built on a branch, waiting to merge

- `wt/W4-NEXTROWS` @b3fdf1c7: FP-DR-18 die work log (migration `0038_next_rows`, renumber to the next free number, D30), FP-OP-21 press plan and summary on the owner's phone, FP-PF-17 plant switcher, FP-OP-14 dispatch value from order-line rates, FP-OP-19 order sheet / shift die list / order book Excel, FP-PF-14 release notes on About, FP-PR-19 offline outbox for the station. Ranks: re-pass 35, 45; base 36; audit PF/OP rows.
- `wt/W4-MASTERS` @29261376 (fix round open): reason-code CRUD (audit 40), collector UIs (audit 46), `dispatch.create` / `dieInstance.addReading` replay keys (audit 47), spool `job_key` (audit 44), nitriding `closeG` server-derived (base 19), die-file R2 lifecycle (base 18), Today trend on the production day (base 20), reduced motion (base 22), password-reset rate limit (base 23); migration `0034_w4_masters`, `docs/R2_BUCKETS.md`.
- `wt/W4-TESTSWEEP`: per-file server runner (`bun run test:server:files`), e2e groups A/B/C (`bun run e2e:group`), ICU-pinned web tests, load timeouts, e2e flake fixes. Ranks: base 27, 28; audit 49, 56.
- `wt/W2-SEED`: the consolidated demo plant (`docs/DEMO_PLANT.md`, 13 role logins plus platform staff and the KD portal party). Rank: base 17, audit 38.

## Not built yet (decided; pick which are pilot-blocking)

| Item | Detail | Rank |
|---|---|---|
| Late PL entry for line-down hours | `occurredAt` (at most 72 h back, never future) + reason + `late_entry` flag + second-person approval; dispatch timestamp and ledger `posted_at` use it; guide "When the internet is down" in en, hi, gu. Until then a paper PL is entered later at the time of entry (Q30). | arch 52 |
| Tolerance at scan | Amber "Over +5% on line n" when an add passes the line limit; the scan sheet raises `dispatch_overdraw` then, not only at complete; the web complete sheet passes `overdrawNote`. | pl-flow 61 |
| Dispatch header entry | Vehicle, driver, transporter, capacity entry exists ("Edit details"); missing: complete refuses without a vehicle number, a confirm check "Vehicle and ship-to are correct", native entry. | pl-flow 62 |
| Ship-to per dispatch | "Same as bill-to" or a second customer address (unit 2, job worker) snapshotted into `header.shipTo`; needs a customer address list. | pl-flow 63, base 7 |
| Dispatch off-band approval | Q36 is a warning today; the owner decision is "needs approval": approval kind `dispatch_off_band` (approvers manager/admin/owner, requester cannot approve), row added in a needs-approval state, review blocked until decided. | pl-flow 64 |
| PL print polish | Footer "Not a tax invoice, generated from the locked snapshot of {PL} rev n" and "Page x of y", signature lines Packed by / Checked by / Driver received, group title with ordered kg/12ft and PO date, a Print button beside PDF, PDF named `{PL}_{customer}.pdf`. | pl-flow 65 |
| Dispatch labels | On demand only, on a completed dispatch (Q38): a 100x50 template per bundle with PL no, n/N, party no, section, cut, pcs, kg/12ft, kg, customer, city, PO; "Reprint one"; A4 fallback. | pl-flow 66 |
| Scan refusal wording | `dispatched` names the PL number and date, `void` names reason and date plus "keep it aside", a non-orrn code reads "Not an orrn bundle label" with "Type bundle number" and "Reprint this bundle's label" (en, hi, gu). | pl-flow 67 |
| Rejected-scan log | Store each refused or needs-approval scan (code, outcome, reason, who, when), list with filters All / On PL / Needs OK / Rejected; review shows Removed and Rejected lines; refused rows never reach the snapshot. | pl-flow 68 |
| Weak link at the bay | Phones queue scans and replay in order when the link is back ("N scans to sync" chip, offline banner); finalize, numbering and labels stay online; no plant box (Q41). | pl-flow 69 |
| Scan to verify QR on the PL | A signed public link with PL number, revision, date, customer, bundle count and kg, no prices, no chemistry. | pl-flow 70 |
| Device on audit rows | `writeAudit` records `deviceId` (native `device.register` id or spool node) and app version for floor writes. | arch 55 |
| Customer alias | `customer_alias` like `vendor_alias`: legacy PL / order import and dispatch customer pick resolve through it, plus a merge flow (R-05). | arch 56 |
| Rebuild port map | Table, column, enum and approval-kind names to SAD section 8.1 names, id format, DN = `dispatch.complete`, print status names, kept in `docs/superpowers/review/2026-10-03-architecture-digest.md` section 12 (no new file), updated at the end of each wave. | arch 57 |
| Count-phantom void releases a hold | `approvalApply` `phantom_void` does not release an order hold the way a bundle void does (D17 gap). | base 24 |
| Alloy and temper pick lists | FP-DR-14: free text with a datalist today. | re-pass 39 |
| Auto-suggest bundles to target kg at pack | Teardown item for FP-PK-11; dispatch suggest exists, pack does not. | base 3 |
| Native follow-ups | Reprint button on the bundle page, typed routes, "Packed by" needs the user name from the API, hold / release UI for orders (OP-17 is web only), nitriding and maker lists partial, `native.*` Gujarati review. | base 5, audit 29 |
| Test gaps | e2e for maker send / receive and nitriding out / back, the approvals inbox as its own flow, `/audit` outside platform.spec, Maestro on a device. | base 19 |
| Settings gaps | `orderLeadDays` has no settings screen (set with `company.updateSettings`); stale copy in `settings.modules.portalEnabledHint` and `settings.team.portalBody` says the portal opens later; spool.retryJob must not mark a job queued when the spool call failed (verify). | base 7 |
| Small verify list | Pack minors from T20 (tile wording with a draft, cut-length print rule, 820 yard tile wrap, override Feet / Inches labels, PackBar toast lift, sign-out clears `orrn.packDraft`) and die-room minors m-6 (dead approver check), m-8 (self-approval assertion, duplicate-guard race test), m-10 (issuer / creator names, signed image URLs in `die.get`): check on the merged head and delete the row if already done. | base 2, 18 |

## Later (Next and Later rows of the specs)

- FP-DR-20 share a section drawing with a party (signed expiring link, revocable, audit row) - re-pass 48.
- FP-PF-18 station PIN (deferred, OI-06) - Later. FP-PK-06 Bluetooth label printer for a small plant - Later. FP-FD-20 casting cost hook - Later.
- A dedicated stock-age screen beyond `/reports/stock-age` and the Today tile, rate slices of the reports behind `order.price` - only if the plant asks.

## Locked product constraints

- Shared D1 database with tenant-scoped operational tables; `companyId` comes from authenticated server context, never from tenant API inputs.
- A person can belong to several plants: one membership per (user, plant), each with its own role; the plant switcher chooses (FP-PF-17). Platform admins are separate from company users and can list, suspend, and time-box impersonate tenants.
- Native offline sync is tenant-local and limited to the floor-worker subset (not built; floor writes are online with replay keys).
- Workers do bounded, indexed, short-lived work only; at most 100 bound parameters per D1 statement.
- PDF and xlsx exports are generated client-side from server-generated snapshots. Printing goes through per-tenant LAN `orrn-spool`.
- Accounts stay outside ORRN (O1): no accounting, GST e-invoice or e-way bill, Tally export or invoicing in this product line; prices on orders are operational data.
