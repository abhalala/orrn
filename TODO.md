# ORRN TODO

Open work only, at `wt/FP` fbe18910 (2026-10-25, end of the FP build). History (milestones M0 to M9, the plant waves W0 to W4, the foundry and ageing lanes) is in git and in `docs/superpowers/plans/2026-10-24-orrn-fp-integration.md`; what is built, row by row, is the status column of each FP spec in `docs/superpowers/specs/` (132 of 138 rows Built; FD-02, FD-11, FD-19 and AG-15 Partial; PK-06 and PF-18 Deferred). Every item carries its backlog rank (`BL n`, from `.fp-build/BACKLOG.md`; where a rank repeats the band is named: `base` 1-29, `re-pass` 30-48, `arch` 50-57, `pl-flow` 61-70, `audit` the later 28-56 rows; ranks from 57 up to 114 are unique). The status column of `BACKLOG.md` was never kept in step; this file is the open list. FP ids (FP-XX-nn) are the rows of the specs. Keep it in step with the work: move an item out when it is done, add one when a decision creates work.

## State

- Every plant module is built end to end on the web, with the phone app for the floor roles: die room (with the share link), orders and planning, press (station, queue, report, collectors as simulators), foundry (casts, melts, spectro, count-based close, trace, certificate, yield), ageing (ovens, trolleys, recipes, batches, release, pack from a released line), pack, stock, dispatch from an order, packing list v2, stock count, platform (modules, shifts, thresholds, releases, backups, audit, support, approvals with live facts), customer portal, analytics and reports. 44 guides in en and hi; Gujarati for the floor.
- Gates at `wt/FP` fbe18910: types 11/11; server 3005/0; domain 358; i18n 64; web 1375/0; native 901 + types + expo android; build `/` 223.5 kB of 250; e2e A 317 (+10 skips), B 431, C 489, 0 failed.
- FINAL-FIXES-4 removes `features/preview` and repoints `/preview/ageing*` to `/ageing` and `/reports/ageing`.
- `main` is at b276f9cd (dev D1 at migration 0035; the dev deploy stopped at the R2 permission), `prod` at c6cb44b3 (migration 0009). The candidate is fbe18910 with migrations to 0041. See `docs/DEPLOY_PROMOTION.md`.
- Three things are not in this file because they are the owner's: the owner-only list is `docs/OWNER_HANDOVER.md`, device bring-up is its own section below (O9), and Gujarati is its own section below (O8).

## Owner only (no agent can do these)

The list with pointers, defaults to confirm and the exact commands is `docs/OWNER_HANDOVER.md`. In short:

| Item | Detail | Rank |
|---|---|---|
| R2 and the dev deploy | Enable R2 on the Cloudflare account and give the dev and production tokens "Workers R2 Storage: Edit"; re-run Deploy Dev. Dev serves the old code until then. | - |
| Prod go | Promote `main` to `prod` only on the owner's explicit go: `docs/DEPLOY_PROMOTION.md` sections 1 and 4. | - |
| Prod email | Resend sends failed in Oct 2026; invite and reset links depend on it. Godseye shows copyable sign-in details meanwhile. | - |
| Hardware | Scale indicator (Q5), TSC label printer template (Q31), press PLC (Q46), spectrometer (Q47), billet weighing cell, and the ageing oven controller (AG-17: the server route `POST /collector/ageing/readings` and `OVEN_SIMULATOR` exist; there is no orrn-spool oven collector, so the owner supplies controller make, protocol and network path). Simulators stand in for all of them. | base 11, audit 46 |
| Spool repo | Merge `fp/scale-reader` and `fp/collectors` into orrn-spool `main` (Go 1.24 toolchain), install it on the packing PC. | base 10, audit 45 |
| Real data | Section CSV, legacy bundles as unassigned (`legacy_bundle_map`), `castSeriesStart` (no screen: API or import only, see FD-02 below), die copies, drawings by file name (Q18), opening balances for the foundry's return streams, accounts for real people (plant admin = Dad, Q32), parallel run with FCMS. | re-pass 39, BL 72 |
| Questions | Confirm or change the defaults taken: Q1-Q4, Q6-Q20, Q23, Q25, Q37, Q42-Q45 and the new Q49-Q63 (die share link, ageing, cast close count, write-off, duplicate reasons, "To log", nitriding copies at pack). | - |
| Pilot and training | Packing bay 1 week, die room desk 1 week, press tablet 2 weeks after a cast exists. | - |

## Native device bring-up (POST-FINAL, owner decision O9)

The first task after the web is complete and dev is deployed; no agent time goes into SDKs or device builds before that. Native code parity continues per module (unit tests, types, expo export, `expo export --platform android` is green); nothing has run on a device. BL 108, base 5, audit 29.

- Toolchain: JDK 17 and the Android SDK on the Mac, or EAS credentials; `bunx expo run:android` for a development build; EAS production Android build; iOS and iPadOS through EAS and TestFlight (an Apple developer account). A new build is required: `expo-application`, `expo-crypto`, `expo-speech` were added in native passes A and B, and `expo-camera` carries the foundry spectro photo (`docs/DEPLOY_PROMOTION.md` section 6).
- Run the 10 Maestro flows (`.maestro/flows`) on a real phone; none has ever been run.
- Device-only checks: the foundry spectro photo (`expo-camera` capture near 2.2 MP re-encoded under 1 MB; the camera permission flow), haptics, spoken refusals (`expo-speech`), a label printed from the phone, the tablet layout of the press station on an 11-inch iPad or Android, the ageing station on a real phone.
- Publish the build in Godseye under App builds so the release gate lets it in.
- Phone gaps that need no device and can be built any time: typed routes, "Packed by" needs the user name from the API, hold and release UI for orders (OP-17 is web only), nitriding and maker lists, Scan-tab lot and stream scanning into the open foundry draft, chemicals and LDO dips editable on the phone, read-only furnace and alloy lists under More, spectro void, cast cancel and `melts.cancel` on the phone (BL 77).

## Gujarati (later, dedicated translation agent)

Owner decision O8 (2026-10-25): Gujarati is last priority; floor work comes first. en and hi parity is the gate and stays; existing gu stays; gu gaps do not count against the definition of done. Nothing here blocks the pilot in English and Hindi.

- BL 87, loanwords: decide and apply one rule for Dispatch, Die, Bundle, Press in hi and gu script (today hi writes "प्रेस" but "Die", "Dispatch", "Bundle" in Latin; gu keeps all four in Latin). A sweep script and the gu wording of the namespaces below are drafted in `.fp-build/drafts/gu-later/` (`sweep.py`, not applied). The quoted names in guides must stay equal to the dictionary values, so sweep dictionaries and guides together.
- BL 90, press board, press queue and the whole store: `press.title`, `press.board`, `press.queue`, `press.late`, `press.linesPage`, `press.lines`, `press.summary` and `store` (about 295 strings) are English in gu. Drafts: `.fp-build/drafts/gu-later/press.ts` and `store.ts` (`gu-more/*`, add to `mergeGu` and `GU_FLOOR_NAMESPACES`, extend `GuMessages`). The "Press" nav label stays English in gu until the loanword rule lands.
- The nine new guides (`open-cast`, `melt-entry`, `spectro-attach`, `cast-close-count`, `load-trolley`, `age-and-release`, `pack-from-trolley`, `die-share-link`, `approvals-review`) read English in gu; add them to `GUIDE_SLUGS_GU` with gu text (the foundry and ageing namespaces already have gu strings for every name they quote).
- Foundry office parts (certificate, masters, yield report), the Today sweep from the owner walk-through (the "Stock older than 90 days / 0 kg in the yard" card, "Show table", "7 waiting", the "Night" shift chip in hi and gu), and any W4-GU leftovers in `.fp-build/reports/gu-review-list.md` and `gu-review-list-web.md` (the 12 word choices come first).
- The native-speaker review of all of it, then flip `GUJARATI_DEFAULT_FOR_GUJARAT_PLANTS` (owner step). The Hindi review list is `docs/superpowers/review/hindi-review.md` (regenerate with `bun run --cwd packages/i18n export-review` after any dictionary or guide change).

## Build backlog

Bands: **Next** = decided by the owner or a go-live risk, small; **Soon** = real gaps found by explorers, none blocks the pilot; **Later** = designed, not decided to build.

### Next

| Item | Detail | Rank |
|---|---|---|
| FD-02: cast book screen | No screen for `castSeriesStart` (where the cast series continues from the paper book) and no entry of a legacy cast code; today API or import only. FP-FD-02 is Partial until then. | audit-final-2 |
| FD-11: open the spectro file | `foundry.spectro.file` has no caller: the attached file is never shown again on the melt sheet (web and phone). FP-FD-11 is Partial until then. | audit-final-2 |
| AG-15: pieces on the order line | `ageing.forOrder` returns loaded, packed and remaining pieces per line, but no screen reads it; the order strip shows only the Aged kg cell. FP-AG-15 is Partial until then. | audit-final-2 |
| Dispatch off-band approval | Q36: the dispatch scan compares the bundle kg/12ft with the ORDER LINE kg/12ft ± 0.1; today a warning, the owner decision is "needs approval": approval kind `dispatch_off_band` (approvers manager/admin/owner, requester cannot approve), the row is added in a needs-approval state, review blocked until decided. | pl-flow 64, BL 71 |
| Server refusal without a vehicle | `dispatch.complete` should refuse with no vehicle number. The web and phone gate exists (`vehicleGate` in domain); the server change touches about 230 tests in 28 files, so do it as one coordinated change. | BL 70 |
| Tolerance at scan | Amber "Over +5% on line n" when an add passes the line limit; the scan sheet raises `dispatch_overdraw` then, not only at complete; the web complete sheet passes `overdrawNote`. | pl-flow 61 |
| Late PL entry for line-down hours | `occurredAt` (at most 72 h back, never future) + reason + `late_entry` flag + second-person approval; dispatch timestamp and ledger `posted_at` use it; guide "When the internet is down" in en, hi, gu. Until then a paper PL is entered later at the time of entry (Q30). | arch 52 |
| Bulk acknowledge | No "acknowledge all ended alerts" on `/press/alerts` (owner tour): add with `press.close` and an audit row. | BL 109 |
| Ageing block for plants without the module | `dashboard.today().ageing` returns 0/0/0 for a plant without the ageing module (the tile is hidden client-side on web and phone); the server should omit the block. | BL 113 |
| Pack phone Review | The "For order" line should sit above the sticky bar (owner tour 99, second half). | BL 111 |
| Prod logs: email in a Better Auth message | Better Auth's own logger prints the address on "Reset Password: User not found" (PII in prod logs): custom logger or suppress. | BL 69 |
| Purchase register columns | The register screens do not show `meltedKgG` and `remainingKgG` per lot (the server returns them). | BL 74 |
| Foundry yield per stream | `analytics.foundryYield` should split metal in by return stream so the report shows kg in per stream (FP-FD-19 is Partial until then). | BL 75 |
| Collectors card wording | The Standards collectors card reuses Today's "Press alerts open: N" string; give it its own key. | BL 67 |

### Soon

| Item | Detail | Rank |
|---|---|---|
| Replay for downtime, remarks and handover | `press.downtime.start/stop` take `clientMutationId` + `tappedAt` so downtime can be queued in the station outbox (the server stamps the resend time today, which is the wrong window); remarks and handover are not queued either. The 30-minute WAN-pull test of the outbox is owner. | BL 60 |
| Renumber plant-stock bundles at dispatch | A plant-stock bundle scanned onto another customer's load keeps its plain serial. The fuller fix renumbers at add/scan and sets `sticker_stale` (the flag, the "Sticker needs reprint" badge and the move-time reset exist). | BL 76 |
| Ageing load picker (web) | `availableLines` is capped at 100 with no paging; the capacity chip ignores pieces already on the trolley; the bundle picks drop silently when the search changes; the web sends `batchId` under one page-long key (a re-read can change the body under the same key). Align it to the phone's `loadBody()` / attempt pattern. Also not built: typed (manual) trolley lines and a device screen for the oven collector. | BL 112, W3-AG-N m-7 |
| Review minors | Reprint can print nothing in one path; the approvals sheet and the phone review show a plant-added reason as its raw key; no server test for the D18 automatic `requireCastOnBundle` rule; reason pickers are empty while loading or offline. Check each on the head and delete the row if already done. | BL 63 |
| Reprint reason, rejects on the saved session, seed ordering | Explorer lows L5 (reprint reason picker + server input), L6 (rejects on the saved session page), L11 (seed ordering CNT-1 / opening voucher / PP-2). | BL 71 |
| Role-shaped Today | Die room and store get their own tile set (foundry and ageing have theirs). | BL 101 |
| Owner question: parties see die drift and trial copies? | The portal leads with the customer's PO and invoice; whether it also shows die drift and trial copies to a party is the owner's call. | BL 103 |
| Order timeline | List dispatches and invoices on the order timeline. | BL 104 |
| One set of stock-age buckets | Today, Stock and the report use the same buckets or say how they differ. | BL 105 |
| Explorer lows | L2-L18 of the owner walk-through that are still open (language card text, cast switch, held-dispatch rounding, PL columns, chart tooltip and curves, die life wording, ISO dates, approval card title, empty released plan, stock header lines, role nav noise, OK on a beyond-tolerance lot, public link without `?c=`, DSP gaps, date input format check, viewer export). | BL 107 |
| Test health | `chain.spec` @1280 press-plan step flaked once (planned 7,493,835 vs 8,000,000 g); `pack.spec:227` weight caret; `w2-fd-s-foundry` 'a REAL tail' uses a UTC day vs the production day; the press report table fits 1280 at 941 of 943 px (`expectTableFitsFrame`, fragile); `die-room-flows` leaves on_trial copies it cannot retire. W4-TESTSWEEP-2 owns the first four; drop each row when its merge lands. | BL 73, 64, 110, 114, 66 |
| Test gaps | The approvals inbox as its own flow, `/audit` outside `platform.spec`, Maestro on a device. (Maker send / receive and nitriding are covered by `die-room-flows.spec.ts`.) | base 19 |
| Settings gaps | `orderLeadDays` has no settings screen (set with `company.updateSettings`); `spool.retryJob` must not mark a job queued when the spool call failed (verify). | base 7 |
| Small verify list | Pack minors from T20 (tile wording with a draft, cut-length print rule, 820 yard tile wrap, override Feet / Inches labels, PackBar toast lift, sign-out clears `orrn.packDraft`) and die-room minors m-6, m-8, m-10: check on the head and delete the row if already done. | base 2, 18 |

### Later

| Item | Detail | Rank |
|---|---|---|
| Dispatch header | Vehicle, driver, transporter and capacity entry exist on web ("Edit details") and the phone asks for the vehicle number before it completes (`vehicleGate`); missing: the confirm check "Vehicle and ship-to are correct", which waits for ship-to. | pl-flow 62 |
| Ship-to per dispatch | "Same as bill-to" or a second customer address (unit 2, job worker) snapshotted into `header.shipTo`; needs a customer address list. | pl-flow 63, base 7 |
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
| Ageing and foundry extras | A device screen for the oven collector (AG-17); casting cost beyond the cast page; Bluetooth label printer for a small plant (FP-PK-06, no printer at the plant); a station PIN (FP-PF-18, Q33 says own account on any phone). | AG-17, FD-20, PK-06, PF-18 |
| Stock-age screen and rate slices | A dedicated stock-age screen beyond `/reports/stock-age` and the Today tile, rate slices of the reports behind `order.price`: only if the plant asks. | - |

## Locked product constraints

- Shared D1 database with tenant-scoped operational tables; `companyId` comes from authenticated server context, never from tenant API inputs.
- A person can belong to several plants: one membership per (user, plant), each with its own role; the plant switcher chooses (FP-PF-17). Platform admins are separate from company users and can list, suspend, and time-box impersonate tenants.
- Native offline sync is tenant-local and limited to the floor-worker subset (not built; floor writes are online with replay keys, the press station keeps an outbox).
- Workers do bounded, indexed, short-lived work only; at most 100 bound parameters per D1 statement.
- PDF and xlsx exports are generated client-side from server-generated snapshots. Printing goes through per-tenant LAN `orrn-spool`.
- Accounts stay outside ORRN (O1): no accounting, GST e-invoice or e-way bill, Tally export or invoicing in this product line; prices on orders are operational data.
- Migrations after the head are additive and consecutive; a step that changes existing data is flagged for the promotion (`docs/DEPLOY_PROMOTION.md`).
