# orrn plant modules — design spec

Date: 2026-10-03 · Builds on: `2026-10-03-orrn-c2-redesign-design.md` (C2 UI, shell, Today/Pack/Stock/Dispatch) · Source of truth for plant facts: `docs/superpowers/review/2026-10-03-architecture-digest.md` (digest of ORRN-SAD-001 Rev D). Field lists, units and rules for each stage live in digest §2 (stage N) and §3 (entities); this spec decides HOW orrn builds them and only repeats what it changes.

## 1. Intent

**User request (2026-10-03):** use the orrn System Architecture knowledge (scrap intake → foundry → press → ageing → packing → dispatch, plus store, die room, orders, reports) to evolve orrn.in into the complete plant product, in a self-correcting loop, taking engineering decisions myself and leaving only true ambiguities for the owner at the end.

**Success:** a Fourcubes user can run a full day on orrn.in: weigh a scrap lot with party vs FC kanta and a D/C note, open a cast and charge lots/returns, run the press with die in/out and stop reasons, cut/QC/age, pack bundles with plant numbers at a yard location, move and count stock with a phantom report, take an order and see baki, dispatch with vehicle and a real PL header, issue store items, keep die cards/nitriding/tier history, and read the 7 am report — on phone, iPad and laptop, in English or Hindi, with the ledger balancing.

**Judged by** the owner's measures (digest §1.4): phantom bundles < 1 % after a count, 0 dispatched-not-sold, every PL with header, every bundle with die instance + cast, no short-weighed lot without a D/C note.

## 2. Architecture decisions (taken now)

| # | Decision | Why | Revisit when |
|---|---|---|---|
| P1 | **Stay on Cloudflare Workers + D1** for orrn.in; build the document's data model and screens on it. Plant box (ADR-001), MQTT/PLC telemetry (ADR-006), Go print agent (ADR-007), GST egress VPS (ADR-008), split DNS (ADR-014) are NOT built in this phase. | User wants the product on orrn.in now; those need hardware/IP decisions (OI-01, 03, 05). | Owner approves the plant box hardware. |
| P2 | **Telemetry-ready, typed-first**: every field the document says comes from the PLC/aggregator (billet events, speeds, temps, billet counts) is a nullable column that is typed today and can be auto-filled later; rows carry `source: 'typed' \| 'telemetry' \| 'import'`. | R-01: press sheet stays manual until Phase 7. | Telemetry phase. |
| P3 | **Cast = campaign with melts** (adopts proposed ADR-013). `cast` (year, month, seq → letter code "K31", alloy, status open/closed, close-out) 1→n `melt` (inputs, chemicals, LDO inches, 5 timestamps, by-products, logs out, spectro). If a cast is one melt, it has one melt. Bundles and press runs reference the cast. | Supports both answers to OI-08 without schema change. | OI-08 answered (only UI wording changes). |
| P4 | **Section vs die instance**: the existing `die` table IS the section catalogue (UI: "Section"); add `die_instance` (oblique code `{sectionCode}-{n}` permanent, tier rank with dated history, supplier, trial kg/12ft, hardness, life, FTR, status in_use/available/at_nitriding/retired). Bundle and press run reference the die instance (nullable for legacy). No table renames (additive migrations only). | Digest §12 gap 8/9; tier is re-ranked on the floor. | — |
| P5 | **Append-only kg stock ledger** `stock_ledger` (voucher_type, voucher_id, line, item_kind bundle/scrap_grade/return_stream/billet/store_item, item_ref, location_id, qty_kg (signed, grams as integer), posted_at, created_seq, cancelled flag, reversal_of). Every stock-affecting submit writes document + ledger rows + audit in ONE atomicBatch. Corrections = cancel + reversal rows, never updates. Bundle `status` stays as the projection the UI reads. | ADR-003, ADR-004. D1 has no transactions → atomicBatch is the unit. | — |
| P6 | **Locations** table (kind yard/billet_store/scrap_store/store/wip, code "Y1".."Y6", no default); bundle `location_id` required for new bundles; Move and Count screens; `count_session` + `count_seen` → phantom report (in system, not seen) and found report (seen, not in system). | Phantom stock root cause (62 %). | — |
| P7 | **Document series per (tenant, doc_type, period)** table `doc_series` with `INSERT … ON CONFLICT DO UPDATE … RETURNING` (pattern from Task 6). Formats: bundle `YY` + month letter (A=Jan…L=Dec) + monthly seq (`26I4086`); cast month letter + monthly seq (`K31`, year stored); PL `PL/{FY}/{seq}` with configurable prefix and starting number so the plant's book continues; purchase lot `LOT-{seq}`; MRS/GRN `MRS-{seq}`/`GRN-{seq}`; SO `SO-{seq}`; press run `PR-{seq}`. Bundle numbering mode per tenant (`plant` default for Fourcubes, `legacy` BG-… kept for others); old BG serials stay valid. | Digest §3.7; monthly reset is my reading (see question Q-P1). | Owner confirms reset rule. |
| P8 | **QR contract**: QR = `https://{host}/b/{bundleNo}` (ADR-005). Resolver accepts `26I4086`, old `J540` (asks year, defaults to latest match), legacy cuid via `legacy_bundle_map`, and current BG serials. Public `/b/:no` page shows minimal non-sensitive info to signed-out users (section, kg, pcs, status) and full detail when signed in. | ADR-005, digest §5. | — |
| P9 | **Roles = the document's 12** mapped onto the existing role column (text enum, no migration of storage): owner, admin (= plant admin), manager, office, accountant, supervisor, packer, foundry, press, storekeeper, die_room, operator (= floor operator), viewer. Permission matrix exactly as digest §4.2 (plus QC/ageing/cut → press + supervisor; reports read for office roles). "approve" = submit needs a second user with that role; implemented as `approval` rows (pending → approved/rejected). | §8.2. | OI-11 names the plant admin. |
| P10 | **Many plants per person** (accountant): drop the one-membership-per-user rule in favour of an active company switcher. | §8.2, §8.1. | — |
| P11 | **PIN login on shared station phones is designed but deferred** behind a setting; email login continues. Station pairing + PIN needs OI-06. | ADR-010, OI-06. | OI-06 answered. |
| P12 | **Invoice of record stays in Tally** (OI-07 open): orrn stores the Tally invoice number on the dispatch, prints it on the PL, and exports a monthly sales register CSV. No IRN/EWB calls. Dispatch gains vehicle no, driver name/phone, transporter, PL number from series, PO no(s) from SO lines. | ADR-012 proposed; ADR-008 needs a VPS. | OI-07 answered "orrn". |
| P13 | **Orders**: `sales_order` + `sales_order_line` (section, kg/12ft target, cut length, pcs, kg, finish none/anodise/pvd/6061 as `finish` text), status booking/confirmed/dispatching/closed; produced = bundles linked to the line, dispatched = completed dispatch items linked, **baki = ordered − dispatched** (kg and pcs). Pack suggests the open line for the section; dispatch items link lines. | Order file replacement. | OI-09 decides finishing workflow (job-work challan). |
| P14 | **Purchase**: `vendor` (aliases, GSTIN, usual items, last rate), `scrap_item` + grade masters, `return_stream` master (9 seeded), `purchase_lot` (party kg, FC kg, grade, item, rate ₹/kg, dross %, bill book main/WB/UB, origin, vehicle, status booking→unload→ok, photo URLs optional), `dc_note` (debit/credit, kg diff, bori deduction, reason, tolerance 0.5 % from settings, pending manager approval). Rule: when FC kg < party kg beyond tolerance, submit requires a D/C note. | Stages 1–2. | — |
| P15 | **Foundry**: melt inputs reference purchase lots (kg drawn from scrap stock by grade) and return streams; chemicals/LDO reference store items (writes store issues); outputs logs (pcs, mm, kg) → billet store ledger, dross/Fe → return streams; balance check |in − out − burn| ≤ 3 % warns (manager can override with reason). Spectro: upload file/photo (stored as text/base64 ≤ 1 MB in D1 now, R2 later) + parsed key/values. Close-out explains the tail. | Stages 3–5. | OI-02. |
| P16 | **Press / cut / QC / ageing**: `press_run` (shift A/B/C or day/night from settings, operator, supervisor, cast, die instance, die in/out, billets count & kg (typed), downtime events with reason codes from a master, discard/ends kg, sign-offs), `press_run_line` (cut length, pcs, kg; recovery computed), `die_weight_reading` (current vs last kg/12ft), `qc_entry` (cast, die instance, reject kg, reason code + remark), `ageing_batch` + rows (gas start/end, temp, in/out, cast, die, pcs, kg, hardness, PO). Ledger: −billets, +discard/ends/rejects to Plant Scrap stream. | Stages 8–11. | Telemetry. |
| P17 | **Store**: `store_item` (chemicals, LDO, gas, spares; unit), `store_txn` (GRN receipt / MRS issue / old-for-new exchange), balance never negative (server check), issues can reference a melt or nitriding log. | Stage 18. | — |
| P18 | **Die room**: die card (on die_instance), `nitriding_log` (date, hardness, CR4/CR2/K2S/caustic, signed by; chemicals as store issues), tier re-rank (`die_tier_change` history, die_room proposes, manager approves), drift report (readings trend vs section band; "run this copy first" suggestion = lightest in-band copy). | Stage 19. | — |
| P19 | **Reports** (web, printable, CSV): 7 am daily summary (Today screen + printable page; WhatsApp later), stock by location/section/age, order balance (baki) by customer, purchase register with D/C notes, foundry yield + LDO/tonne, press production + recovery + downtime Pareto, die drift, phantom/found after count, dispatch register, monthly sales register CSV for Tally. | §8.7. | — |
| P20 | **Legacy coexistence**: `legacy_bundle_map` (cuid → bundle), import endpoints for live bundles and sold history from FCMS exports (CSV), customer/vendor alias de-duplication UI ("merge"), resolver accepts old QR until sold. | Cutover phase. | — |

## 3. Information architecture (extends the C2 route map)

Primary nav becomes **role-aware**. Phone tab bar shows the person's station first:

| Role | Phone tabs (5 max, Scan centre) |
|---|---|
| packer / operator | Today · Pack · **Scan** · Stock · Dispatch |
| foundry | Today · Cast · **Scan** · Stock · More |
| press | Today · Press · **Scan** · Dies · More |
| storekeeper | Today · Purchase · **Scan** · Store · More |
| die_room | Today · Dies · **Scan** · Press · More |
| office/manager/owner/admin | Today · Dispatch · **Scan** · Orders · More |

Laptop sidebar groups: **Today** · **Floor** (Purchase, Foundry, Press, Pack, Stock, Count) · **Sales** (Orders, Dispatch, Customers) · **Masters** (Sections & dies, Vendors, Scrap & returns, Store items, Locations, Reason codes) · **Reports** · **Settings** · **Guides**.

Routes added: `/purchase`, `/purchase/new`, `/purchase/:id`, `/vendors(/…)`, `/foundry` (casts), `/foundry/casts/:id`, `/foundry/casts/:id/melts/new`, `/press`, `/press/runs/new`, `/press/runs/:id`, `/qc`, `/ageing`, `/ageing/:id`, `/dies/:sectionId` (section + its die instances), `/dies/instances/:id` (die card, readings, nitriding, tier), `/store`, `/store/items`, `/orders`, `/orders/new`, `/orders/:id`, `/stock/locations`, `/stock/move`, `/count`, `/count/:id`, `/reports`, `/reports/:slug`, `/b/:no` (public resolver), `/masters/*`.

Every floor screen follows C2 floor rules: one big primary action, large numbers, numeric keypads, How-to guide, sticky action bar, works at 375 px, Hindi.

## 4. Data model summary (new tables; all have `id` uuid text, `company_id`, `created_at`, `created_by`, `server_seq`; all writes tenant-scoped, ≤100 bound params, audited)

`location`, `stock_ledger`, `doc_series`, `die_instance`, `die_tier_change`, `die_weight_reading`, `nitriding_log`, `vendor`, `vendor_alias`, `customer_alias`, `scrap_item`, `return_stream`, `purchase_lot`, `dc_note`, `approval`, `cast`, `melt`, `melt_input`, `melt_output`, `spectro_result`, `press_run`, `press_downtime`, `press_run_line`, `reason_code` (kinds: downtime, qc_reject, void, reprint), `qc_entry`, `ageing_batch`, `ageing_row`, `store_item`, `store_txn`, `sales_order`, `sales_order_line`, `count_session`, `count_seen`, `legacy_bundle_map`. Columns added: `bundle.location_id`, `bundle.die_instance_id`, `bundle.cast_id`, `bundle.sales_order_line_id`, `bundle.kg_per_12ft_milli`, `bundle.number_style`; `dispatch.vehicle_no`, `driver_name`, `driver_phone`, `transporter`, `pl_number`, `invoice_number`, `invoice_date`; `dispatch_item.sales_order_line_id`; `customer.kg_tolerance_pct`; `company.settings` keys `bundleNumbering`, `plSeries`, `dcTolerancePct`, `shifts`.

Exact columns follow digest §2/§3; implementers read the stage section for each table.

## 5. Ledger postings (authoritative)

| Event | Rows |
|---|---|
| Purchase lot OK | + scrap (item+grade) @ scrap store, FC kg (minus approved D/C deduction) |
| Melt submit | − scrap per lot input; − return stream per input; + billets (cast) @ billet store; + dross / Fe @ return streams |
| Press run submit | − billets (cast) kg consumed; + discard, + ends @ Plant Scrap |
| QC entry | + reject kg @ Plant Scrap (the good stock reduction is implicit in pack weights) |
| Pack (bundle created) | + bundle kg @ location |
| Move | − at from, + at to (same voucher) |
| Void bundle | reversal of its pack row (+ reason) |
| Dispatch complete (DN) | − bundle kg @ location per item; bundles → dispatched |
| Dispatch cancel after complete | not allowed (completed is final) |
| Store GRN / MRS | + / − store item qty (store items use their own unit; `qty` column generic, `unit` on item) |
| Count close | no kg rows; writes checkpoint; phantom list → "void as phantom" action (manager) |

A ledger balance query (`stock.balance({ at?, location?, itemKind? })`) must equal the bundle projection for bundle items — enforced by a test.

## 6. Delivery order (each phase usable on its own, shipped to prod when reviewed)

1. **Plant core**: roles + approvals + multi-company membership switch, doc series + plant bundle numbers, locations, stock ledger (pack/move/void/dispatch postings), die instances, cast skeleton (needed as FK), QR resolver `/b/:no` + legacy map. Pack gains location + die instance + cast + order line; Dispatch gains vehicle/driver/PL number/invoice no; Move + Count + phantom report.
2. **Orders & dispatch**: sales orders, baki, dispatch item ↔ SO line, PL with full header + 11 columns, dispatch register, sales register CSV.
3. **Purchase & store**: vendors (+ alias merge), scrap items/grades/return streams, purchase lots, D/C notes with approvals, purchase register; store items, GRN/MRS.
4. **Foundry**: casts, melts (inputs/outputs/chemicals/LDO/timestamps), spectro upload, balance check, close-out with tail, foundry yield report.
5. **Press & die room**: press runs, downtime reasons, cut lines, die weight readings, QC entries, ageing batches; die card, nitriding, tier re-rank with approval, drift report.
6. **Reports & cutover tools**: 7 am report, stock by location/age, production/recovery, downtime Pareto, customer/vendor dedupe, legacy import (live + history), count-day reconciliation.
7. **Native** gets the floor screens for its station roles (Pack, Move, Count, Scan, Cast, Press, QC, Ageing, Purchase, Store) once their web versions are stable.

## 7. Testing

Server: harness tests per router (tenant scoping, permission matrix per new action, ≤100 params, ledger postings and balances, series formats incl. month letter and year rollover, approval flows). Web: e2e per flow (purchase lot with short weight → D/C note → approval; cast with melt → billets in stock; press run → bundles packed against die instance and order line → dispatch → baki drops → ledger balanced; count with phantoms). Layout guards at 375/390/820/1280/1440 on every new route; axe clean.

## 8. Out of scope (this phase)

Plant box, LAN-first offline core, MQTT/PLC collector, Grafana wall, Go print agent (printing stays via spool), GST IRN/EWB calls, Tally XML push (CSV export only), AI extraction/resolver (manual merge UI instead), WhatsApp delivery, Postgres/RLS migration, backups beyond D1 Time Travel.

## 9. Questions for the owner (collected; do not block the build)

Defaults taken in brackets.
- **Q-P1** Bundle number sequence resets monthly or yearly? [monthly, since the month letter is in the number]
- **Q-P2 (OI-08)** Is a cast one melt or a multi-day campaign? [campaign with melts; one-melt casts work too]
- **Q-P3 (OI-07)** Tally or orrn prints the tax invoice? [Tally; orrn stores the invoice number]
- **Q-P4 (OI-09)** Anodise/PVD: in-house, job-work out, or label note? [finish recorded on the order line and printed on PL; no job-work flow yet]
- **Q-P5 (OI-06)** Shared station phones with PIN, or personal phones? [email login now; PIN designed, off]
- **Q-P6 (OI-11)** Who is the plant admin? [owner account until named]
- **Q-P7 (OI-02)** Does the spectro PC write a results file? [manual upload of file or photo]
- **Q-P8** Shift names and times? [Day 08:00–20:00, Night 20:00–08:00]
- **Q-P9** Downtime reason list, QC reject reason list? [seeded sensible starter lists, editable in Masters]
- **Q-P10** D/C note tolerance 0.5 % of party kg, and bori deduction per bag in kg? [0.5 %, bori entered per lot]
- **Q-P11** Yard locations: Y1–Y6 plus billet store and scrap store — any others? [those 8]
- **Q-P12** PL book: current prefix and next number to continue from? [PL/26-27/ starting 1, editable]
- **Q-P13** Which five timestamps does the foundry sheet record? [preheat start, charging start, charging end, casting start, casting end — from Data Forms.xlsx]
- **Q-P14** Is the die weight band per 12 ft (Q1 of the redesign list)? [yes]
