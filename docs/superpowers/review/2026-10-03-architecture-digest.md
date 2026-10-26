# orrn architecture requirements digest

| | |
|---|---|
| Source | "orrn System Architecture", ORRN-SAD-001, Rev D, Draft for review, issued 22 Sep 2026 (arc42 + Part I owner's brief + Annex A Fourcubes LLP, Surat). Supersedes Orrn Site Map Rev C (13 Sep 2026). |
| Source file | saved artifact HTML `artifact-5ece365e-1790111146-dfef.html` (English text only; the Gujarati dictionary was ignored) |
| Digest date | 2026-10-03 |
| Repo compared | `/Users/abhalala/Documents/business/fc/orrn` (`packages/db/src/schema/*.ts`, `packages/server/src/routers/**`, `packages/server/src/lib/permissions.ts`, `packages/domain/src/*`, `packages/documents/src/packing-list/*`) |
| Review requested by doc | Fourcubes owner: Part I and §11.1. CA: ADR-012. (cover page) |

## How to read this digest

- Every item cites the section it came from: `§8.1`, `§O.4`, `§A.2`, `ADR-007`, `OI-03`, `Q-05`, `R-02`, `Fig 6-2` (figure captions).
- Anything not stated in the document but needed to make an item buildable is marked **(inferred)**. Anything the document leaves open is marked **(not specified)**.
- "Amber path" = transaction path, every write becomes a ledger row; "blue path" = telemetry, nothing typed (§0.5).
- "Plant-owned / cloud-owned / outbox" = the write owner of a table (§8.1, ADR-002).
- The document describes a target stack (plant box with Postgres 16, Timescale, Mosquitto, Go edge agents, Expo app, Grafana; cloud Postgres with RLS; Indian VPS GST egress). The current repo runs Cloudflare Workers + D1 (SQLite) + tRPC. Section 6 of this digest separates what can be modelled now from what needs the plant box.

### Document-internal inconsistencies worth knowing before building

1. **Cast number rendering.** §8.1 and §A.2 say the cast is stored as `(year, month, seq)` and "shown to staff as K31". §8.8 says "cast K31 (month letter, then sequence; the year is not written)". OI-08 repeats "Letter = month, number = sequence, year not encoded". Consistent reading: store year+month+seq, render only letter+seq. The month-letter alphabet for casts is **(not specified)**; bundle numbers use A–L (§8.3 regex), so casts presumably do too **(inferred)**. Note the sample label (§8.3) shows cast K31 on a bundle dated 13-09-26 (bundle letter I); if K = November under A=Jan, that cast would be from Nov 2025 — so the cast-letter mapping may not be A=Jan **(open, ask: OI-08)**.
2. **D/C note tolerance.** §8.1 writes "₹0.5 % tolerance". Read as a 0.5 % weight tolerance; the "₹" looks like a typo **(inferred)**.
3. **Packer and Dispatch screen.** §8.6 lists "gate, packer" as users of Dispatch; §8.2 gives "Scan bundles onto a packing list" to floor operator, packer, supervisor and office, but "Complete a dispatch" only to supervisor, office and manager. So the gate/packer scans; a supervisor or office completes.
4. **Cast close-out.** §8.2 gives Foundry "approve", Supervisor "yes", Manager "yes". §O.5 says "a supervisor who closes casts". Reading: supervisor or manager performs close-out; foundry sign-off is required to submit.
5. **Phases.** §O.5 says "nine phases on §A.4"; §A.4 lists phases 0–8 (nine rows). R-01 says "Telemetry is phase 7 of 8" (counting 1–8). Same plan.
6. **Section 7.1 "web panel ... needs internet: no on LAN"** versus fault matrix "office web panel works on the LAN only" when cloud down. Consistent.

---

## 1. Goals, quality targets and acceptance criteria

### 1.1 Purpose and scope (§1.1)

orrn is a multi-tenant ERP for aluminium extrusion plants. Each plant runs orrn on a small computer on its own LAN (system of record); the cloud keeps a replica for the office panel, GST compliance, backups and AI helpers. It follows the metal from scrap yard to gate.

In scope (§1.1):
- Scrap purchase with party and FC weights, grades, debit or credit notes
- Foundry casts, spectro results, billets and returns
- Press runs, dies, nitriding, QC and ageing
- Packing, bundle labels, yard stock and counts
- Sales orders, dispatch, tax invoice and e-way bill
- Store issues and receipts; reports for office and owner

Out of scope (§1.1):
- The accounts ledger (stays in Tally with the CA)
- Payroll and attendance
- Brokers (not modelled; "K in name = broker, not kept", §8.1; "Brokers are not recorded", §O.1)
- Any control of machines; orrn only reads the press (ADR-006, §2)

### 1.2 Quality goals, in priority order (§1.2)

When designs conflict, decide in this order:

| # | Goal | Floor meaning | Scenarios |
|---|---|---|---|
| 1 | The floor never waits on the internet | Packing, dispatch, press and stock carry on with the line down | Q-01, Q-02 |
| 2 | Stock is provable | Every kg that moves is a ledger row; a count either matches or names the bundles that differ | Q-03, Q-05 |
| 3 | Every bundle is traceable | Bundle → die, press run, cast, scrap lots, and the truck that took it | Q-04 |
| 4 | Floor staff use it in their language | Paper forms become screens with the same columns, Gujarati or Hindi | Q-06 |
| 5 | Plants never see each other's data | One cloud, each plant sees only its own rows | Q-07 |

### 1.3 Quality scenarios as acceptance tests (§10)

| ID | Quality | Given | Then | Pass measure | Checked by |
|---|---|---|---|---|---|
| Q-01 | Availability | Internet down for a week | Packing, dispatch, press sheet and stock carry on; invoices print as proforma and get IRN when the line returns | No floor hours lost | The cable-pulled week (§O.4) |
| Q-02 | Recoverability | Plant box fails | Spare restored from last night's encrypted copy; phones replay the morning from their outbox | Back in about an hour, no floor entries lost | Restore drill |
| Q-03 | Integrity | A yard count | Screen and yard agree; each difference named by bundle | Phantom bundles < 1 % | Phantom check (§8.7) |
| Q-04 | Traceability | Customer complains about one bundle | Bundle → die, press run, cast, spectro, scrap lots in one report | On demand, one screen | Cast traceability report (§8.7) |
| Q-05 | Exactly once | A print job is delivered twice | One label printed | Zero duplicate labels | Label audit (§8.7) |
| Q-06 | Usability | A new packer starts | Half a day of training in Gujarati on the real floor, then packs unaided | Reprints and refusals fall week on week | Weekly questions (§O.4) |
| Q-07 | Isolation | A user of one plant queries the cloud | Only that plant's rows return | Zero rows from another tenant | CI check on every table |
| Q-08 | Timeliness | A truck leaves the gate | Invoice and e-way bill issued that day | Same day | Dispatch register (§8.7) |
| Q-09 | Accuracy | A press shift ends | Auto-filled billet count matches operator's count | Within 2 % | Phase 7 exit (§A.4) |

### 1.4 Owner's "how to judge it" measures (§O.4) as acceptance criteria

The doc: "If a number does not move, the system has not earned its place." Baselines are Fourcubes' own data.

| # | Measure | Baseline today | Target | Where it shows | Acceptance test (wording is the digest's) |
|---|---|---|---|---|---|
| M1 | Bundles in system but not in yard at count | 1,071 of 1,721 (62 %) | < 1 % | Phantom check after each count | After a full count, `missing / expected` at counted locations < 0.01 |
| M2 | Dispatched bundles never marked sold | 1,630 of 6,367 | 0, by design | Dispatch is the stock change | No bundle exists that is on a completed dispatch and still has positive stock; enforced by DN submit = ledger out (ADR-004) |
| M3 | Packing lists without customer, date or number | All of them | None | PL header | Every PL record has non-null customer, date and PL number |
| M4 | Customer names for ~40 customers | 69 | 40 | Customer master | Customer master de-duplicated to ~40 with aliases (R-05) |
| M5 | Bundles with no die recorded | All of them | None | Bundle record | `bundle.die_instance_id` NOT NULL for every new bundle |
| M6 | Press sheets typed by hand | Every shift | None | Auto-filled press run | Press run billet rows come from the aggregator (Phase 7) |
| M7 | Time from truck leaving to invoice issued | Hours to days | Same day | Dispatch register | `invoice.issued_at::date == dn.submitted_at::date` (Q-08) |
| M8 | Die found heavy by customer before plant | Happens | Never | Die drift report | Die drift report flags out-of-band kg/12ft before dispatch |
| M9 | Hours of work lost when the internet drops | None today | None after | Fault matrix (§8.5) | Q-01 |
| M10 | Scrap lots short-weighed without a debit note | Unknown | None | Purchase register | Every lot where FC kg is short beyond tolerance has a D/C note |

Four tests before the owner trusts it (§O.4):
1. One full month packed and dispatched with no Excel packing list.
2. A yard count that matches the screen, difference explained bundle by bundle.
3. One month of invoices reconciled by the CA without a phone call.
4. One week with the internet cable pulled out and nothing on the floor stopping.

Weekly questions for the first three months (§O.4) — each needs a report or query:
- How many labels were reprinted, and why → label audit (§8.7) must record reprints with reason.
- How many bundles did the phone refuse at packing, and was it right → Pack screen refusals/warnings must be logged **(inferred: a refusal log)**.
- How many names did the office have to fix by hand → reconciliation / resolver audit.
- Which cast was closed with a tail nobody could explain → cast close-out must record the tail explanation.

### 1.5 Constraints (§2)

| Kind | Constraint | Shapes |
|---|---|---|
| Technical | IRP and e-way bill APIs accept calls only from a registered static Indian IP | ADR-008 |
| Technical | IRN cancel only within 24 h and only while no e-way bill is active. Tenants with turnover ≥ ₹10 Cr must report invoices within 30 days | §6.2, §8.7 |
| Technical | Nothing is ever written to the press PLC | ADR-006 |
| Technical | Internet drops for hours most weeks; power cuts happen; UPS gives ~20 min | ADR-001, §8.5 |
| Technical | Floor phones are Android and iOS, installed from one store listing | §8.6 |
| Organisational | Built in phases, each ending with something the floor uses | §A.4 |
| Organisational | Tally stays with the CA until ADR-012 is decided | §6.2 |
| Organisational | Old labels and the legacy database stay readable through cutover | ADR-005, §A.4 |
| Convention | Kg per 12 feet is the unit of trade | §8.8 |
| Convention | Plant's numbers are kept: cast K31, bundle 26I4086 | §8.8, ADR-005 |
| Convention | Floor screens are in Gujarati or Hindi and keep the plant's English words | §8.6, §8.8 |

### 1.6 Stakeholders (§1.3)

| Stakeholder | Expects | Reads |
|---|---|---|
| Plant owner | Numbers that agree, no stoppage, a clear list of decisions | Part I, §11.1 |
| Office staff | Orders, stock and dispatch on one screen; no move-to-sold step | §6.2, §8.7 |
| Floor operators | Forms they know, big buttons, own language | §8.6, §A.2 |
| Supervisor and plant admin | Voids, cast close-out, users and PINs, restorable box | §8.2, §7 |
| Accountant and CA | Invoices linked to PLs, GST files ready, Tally export | §6.2, ADR-012 |
| orrn engineering | Design that holds as plants are added, decisions written down | §4, §5, §9 |
| GST systems: IRP and NIC | Correct e-invoices and e-way bills inside their windows | §6.2, ADR-008 |

### 1.7 Business context: external partners (§3.1)

| Partner | Sends to orrn | Gets from orrn | Channel |
|---|---|---|---|
| Scrap vendors | Lots, weighbridge slips, bills | Debit or credit notes | Purchase screen, challan photos |
| Customers | Orders | PL and invoice PDF | Office panel |
| CA and Tally | — | Monthly export, GST return files | Tally XML, JSON |
| IRIS IRP | IRN and signed QR | e-invoice request | API from the Indian VPS |
| NIC e-way bill via ASP | EWB number, validity | e-way bill, vehicle (Part-B) | API through the ASP |
| Press PLC | Samples at 1 Hz | Nothing, ever | Modbus TCP, S7 or OPC UA |
| Spectrometer | Results file per melt | — | Folder watcher |
| Owner's phone | — | 7 am daily report | WhatsApp |
| Play Store and App Store | — | Operator app | One listing, demo.orrn.in for review |
| Claude API | Answers to tool calls | Names, photos, records to reconcile | HTTPS from the cloud AI service |

### 1.8 Solution strategy (§4)

| Problem | Approach | ADR |
|---|---|---|
| Floor cannot wait on internet | Plant box on LAN is system of record; phones write to a local outbox first | ADR-001, ADR-010 |
| Stock went missing on paper | One transaction per write: document + ledger delta + audit row. Ledger only grows. Dispatch is the stock-out | ADR-003, ADR-004 |
| Plant and cloud both hold data | One writer per table; shared rows via outbox | ADR-002 |
| Exactly one label per bundle | Durable print agent at packing, idempotent on job id, with acks | ADR-007 |
| Press data without typing | Read-only PLC tap from its own network segment | ADR-006 |
| GST needs static Indian IP | One egress worker on an Indian VPS | ADR-008 |
| Many plants, one cloud | Forced RLS; host name picks the tenant | ADR-009 |
| Outside access without opening the plant | No inbound ports; tunnels for people, Tailscale for machines; one host name | ADR-014, ADR-015 |
| AI help without floor risk | AI on cloud replica, as the signed-in user, into review queues | ADR-011 |

Target technology (§4, §7.1): TypeScript core with Drizzle on Postgres 16; Timescale (Community) for telemetry; Mosquitto; small Go agents at the edge (PLC collector, print agent, spectro watcher, aggregator); Expo app with expo-sqlite; Grafana OSS on the cabin wall; better-auth (pg); `permissions.ts` shared by server and app.

### 1.9 Owner-facing commitments that become requirements (§O.1, §O.2, §O.3, §O.6)

- Every bundle gets its label the moment it is weighed; label carries section, die, kg, pieces, cast and a QR; nothing typed twice (§O.1).
- PL is made by scanning bundles at the gate; it prints with customer, vehicle, PL number and total (§O.1).
- Stock goes down when the truck leaves; no separate Excel step (§O.1, ADR-004).
- Press sheet fills itself from the press; operator only adds the stop reason (§O.1) — Phase 7.
- Full traceability: scrap lots → furnace → die → packer → truck (§O.1, Q-04).
- Office sees stock by yard location, order balance (baki) per customer, and dies getting heavy, on one screen (§O.1).
- When the internet goes, only the invoice number waits (§O.1).
- Kg/12ft stays the unit; cast numbers stay K31, H24; bundle numbers stay 26I4086 (§O.1).
- Paper forms become screens with the same columns in Gujarati or Hindi with big buttons (§O.1).
- Scrap purchase book keeps party vs FC kanta, bill book (WB/UB), grade and D/C note; brokers not recorded (§O.1).
- Old labels keep working until old stock is sold (§O.1, ADR-005).
- A packer cannot change a weight after the label is printed. A wrong bundle is voided with a reason by a supervisor and packed again; every change keeps who and when (§O.6).
- Everything exports to ordinary tables / Excel; no lock-in (§O.6).
- orrn staff access to tenant data is logged with their name (§O.6, §8.2).

---

## 2. Process stages end to end

Twenty stages, in material-flow order, followed by the beside-the-line stages (store, die room, reports). The ten floor stations of §A.2 are: scrap yard, foundry, billet store, press, stretch and cut, QC, ageing oven, packing, stock yard, dispatch gate. Beside the line: central store, die room, legacy coexistence, order book (§A.2).

Ledger effect per station (§A.2 third row) is the authoritative list of kg movements:

| Station | Ledger effect (kg) |
|---|---|
| Scrap yard | + scrap lot, by grade; daily draws → furnace |
| Foundry | − scrap, − returns; + logs, dross, Fe |
| Billet store | location move: same kg, new place |
| Press | − billets, + discard; ends + rejects return |
| Stretch and cut | + section-ends kg to Plant Scrap stream |
| QC | − reject kg → Plant Scrap stream |
| Ageing oven | no ledger line (process record) |
| Packing | + bundle kg at its location |
| Stock yard | move · checkpoint; balance restarts here |
| Dispatch gate | − bundle kg, sold, timestamped |

Common rules applying to every stage:
- Every submit = one transaction: document + ledger delta + audit row (ADR-003, §5.2).
- Ledger rows never updated or deleted; mistakes are voided with a reason and reversed ("reversal as a set", §8.1; ADR-003).
- Every write from a phone goes through the local SQLite outbox and `POST /api/v1/mutations` with a `clientMutationId`; replay returns the first result (§8.4, ADR-010).
- Every floor screen: one big primary button, large numbers, a queue badge showing what has not reached the box (§8.6).
- Floor labels in Gujarati or Hindi, keeping English plant words (die, cast, PL, kanta) (§8.8).
- Series counters never decremented; `UPDATE … RETURNING`, no reuse (§5.2, §8.1).
- Documents carry a `docstatus` (§5.2, §8.1 "Invoice and line … docstatus") — values **(not specified)**; ERPNext-style draft/submitted/cancelled is the likely meaning **(inferred)**.

---

### Stage 1 — Scrap intake at the kanta (purchase receipt)

| Aspect | Requirement |
|---|---|
| Station | Scrap yard (§A.2) |
| Actors | Yard staff ("floor operator"), storekeeper, office may also enter (§8.2 "Purchase receipt, party vs FC kanta": floor operator yes, storekeeper yes, office yes; §8.6 Purchase: "scrap yard, storekeeper"; §O.2 8:00 "yard, storekeeper") |
| Screen | **Purchase** (ખરીદી) (§8.6) |
| Paper replaced | The scrap purchase book written by hand later (§O.2 8:00); "the purchase book" closed in Phase 4 (§A.4) |
| Record written | Purchase Receipt / Purchase lot (§A.2, §8.1) |
| Write owner | Plant (§8.1) |
| Ledger | + scrap lot kg, by grade (§A.2) |

Data captured (§8.6 Purchase; §8.1 Purchase lot; §A.2 scrap yard and Purchase Receipt):

| Field | Unit / type | Notes / source |
|---|---|---|
| vendor | FK Vendor | "vendor → resolved id" (§A.2); resolved from free text via aliases / AI resolver (§8.1, §5.3) |
| date | date | §8.1 |
| origin | text/code | §8.1; §A.2 example "origin EC · 6063" |
| bill book | enum WB / UB / (main book) | §8.6 "bill book"; §8.1 "bill book"; WB = w-bill (separate, shorter book); UB = under-billed, a lot part of which went to the w-bill (§12, §O.1) |
| grade | enum A+ / A / B / C | §8.1 Scrap item and grade; §A.2 "grade A+…C" |
| quality | text / scrap item | §8.6, §8.1; scrap items e.g. "imp belling, soft cable, …" (§8.1) |
| party kg | kg | Vendor's weighbridge figure (party kanta) (§12) |
| FC kg | kg | Plant's own weight (FC kanta) (§12) |
| rate | ₹/kg **(inferred unit)** | §8.1, §8.6 |
| dross % | % | §8.1, §A.2 |
| photos | images | Challan photographed (§O.2), "challan + slip photos" (§A.2); stored in R2 "label photos" bucket family (§5.3) **(inferred: same store)** |
| status | BOOKING → UNLOAD → OK | §8.1, §A.2 |

Validations (§8.6 Purchase "checks before submit"):
- Vendor resolved (must map to a vendor master id).
- FC kg within tolerance of party kg, **or** a D/C note is started. "If the weight is short, the debit note is started on the spot" (§O.2 8:00).

State machine (§8.1): `BOOKING → UNLOAD → OK`. Transition triggers **(not specified)**; plausible: BOOKING when the truck is announced/booked, UNLOAD at the kanta, OK when weights and grade are accepted **(inferred)**.

Links / traceability:
- Purchase lot → Cast inputs ("inputs: lots + return streams", §8.1; "Lots are picked by number" §O.2 9:00).
- Purchase lot → D/C note (§8.1).
- Purchase register report: lots by vendor, party vs FC kg, D/C notes, rate trend, recovery by vendor (§8.7).
- Vendor "usual items, last rates" (§8.1) suggests prefilling quality and rate from the vendor master.

Typed vs automatic: all typed; photos captured; AI extraction from challan/slip photos goes to a review queue (§5.3, ADR-011) — cloud-only, never blocks the floor.

Plant facts: ~25 vendors (§A.2).

---

### Stage 2 — Scrap grading, debit/credit notes, scrap yard stock

| Aspect | Requirement |
|---|---|
| Actors | Office raises D/C note; manager approves; accountant reads (§8.2 "Debit or credit note on a scrap lot": office yes, manager approve, accountant read) |
| Screen | Started from Purchase screen on the floor (§O.2, §8.6); approved in the office panel **(inferred)** |
| Record | Debit / credit note (§8.1), plant-owned |
| Paper replaced | D/C notes in the purchase book (§O.1) |

Fields (§8.1 Debit / credit note):

| Field | Unit | Notes |
|---|---|---|
| lot | FK Purchase lot | |
| kg difference | kg | party kg − FC kg **(inferred sign)** |
| tolerance | 0.5 % | written "₹0.5 % tolerance" in §8.1 (see inconsistency 2) |
| bori deduction | kg | deduction for bags (bori) **(inferred meaning)** |
| approved by | FK user (manager) | §8.1 "approved by the manager" |
| type | debit / credit | §12 "raised on a scrap lot when the weight or grade differs" |
| reason | weight / grade | §12 |

Grading masters (§8.1, cloud-owned):
- **Scrap item and grade**: items such as "imp belling, soft cable, …"; grade A+ / A / B / C; expected recovery % per item/grade.
- **Return stream** (9 streams charged in the foundry, §3.2, §A.2): ingot, plant scrap, discard, dross ingot, bend log, hill metal, pit, tendis, dross metal (§8.1). Count = 9.

Scrap yard stock: ledger "+ scrap lot, by grade; daily draws → furnace" (§A.2). So scrap stock is held per grade (and probably per lot) in the ledger with location "scrap store" (§8.1 Location: "scrap store").

Rules:
- Short-weighed lots must have a D/C note (M10, §O.4).
- D/C note needs manager approval to submit (§8.2 "approve").
- Purchase register monthly with D/C notes (§8.7).

---

### Stage 3 — Foundry: furnace charge and melt (cast entry)

| Aspect | Requirement |
|---|---|
| Station | Foundry (§A.2) |
| Actors | Foundry lead (§O.2 9:00); supervisor (§8.2 "Cast entry, spectro attach": foundry yes, supervisor yes) |
| Screen | **Cast** (કાસ્ટ) (§8.6) |
| Paper replaced | The paper foundry sheet and the stapled spectro printout; cast number written by hand "and sometimes wrong" (§O.2, §O.3) |
| Record | Cast (§8.1, §A.2), plant-owned |
| Ledger | − scrap, − returns; + logs, dross, Fe (§A.2) |

Captured (§8.6 Cast; §8.1 Cast; §A.2 foundry):

| Field | Unit | Notes |
|---|---|---|
| inputs by lot | lot no + kg | "Lots are picked by number" (§O.2) |
| inputs by return stream | stream + kg | 9 streams (§8.1) |
| chemicals | open / used / close | per chemical; "chem. open/used/close" (§A.2); from store items (§8.1 Store item) |
| LDO | inches on the tank | "LDO inches" (§8.6, §A.2); LDO = light diesel oil (§12); LDO per tonne reported (§8.7) |
| 5 timestamps | datetime ×5 | "5 timestamps a melt" (§A.2); which five **(not specified)** — likely charge start, melt, alloying, tapping, casting end **(inferred)** |
| by-products | kg | dross, Fe (§A.2 "dross, Fe, burn loss") |
| logs out | pcs · mm · kg | "logs: pcs · mm · kg" (§A.2 Cast record) |
| alloy | 6063 / 6061 | §A.2 Cast record; §8.1 "alloy, grade" |
| grade | | §8.1 |
| timestamps | | §8.1 |
| spectro file | attachment | Stage 4 |
| closed? | bool | §8.1 "closed?" |

Validation (§8.6 Cast): **kg in vs kg out plus burn loss balances within 3 %**.
- kg in = Σ lot kg + Σ return stream kg (+ chemicals? **(not specified)**)
- kg out = logs kg + dross + Fe **(inferred composition from §A.2)**
- burn loss = metal lost in melting (§12)

Identity: cast number (§8.1, §8.8, ADR-013) — see §3 of this digest. "The cast gets its K number" from the system (§O.2), not written by hand (§O.3).

ADR-013 / OI-08: a cast is proposed to be a **campaign with melts under it** (K31 ran 35 days and 60 t). If accepted: Cast (campaign) 1→n Melt; the 5 timestamps, inputs and spectro are per melt **(inferred)**; press run and bundle hang off the cast. Must be settled before Phase 1 fixes the schema.

Links: Cast ← Purchase lots, return streams, store issues (chemicals, LDO); Cast → logs (billets) → billet store → press runs → bundles; Foundry yield report (§8.7).

---

### Stage 4 — Spectro (chemistry) attachment

| Aspect | Requirement |
|---|---|
| Actors | Automatic via spectro watcher; foundry / supervisor may attach (§8.2) |
| Device | Spectro PC (Windows) at 192.168.10.41 with a Go folder watcher (§A.3, §7.1) |
| Path | Spectro PC writes a results file per melt → watcher parses CSV → `HTTP to the core` → attaches to Cast (`cast.spectro`) (§5.2, §7.1) |
| Endpoint | Watcher uses `POST /api/v1/mutations` ("app, watcher", §8.4) |
| Paper replaced | Stapled spectro printout (§O.2) |

Rules:
- "The spectro result attaches itself" (§O.2).
- OI-02: if the spectro PC does not write a results file, the attachment becomes a **photo** processed by AI extraction into a review queue (cloud) — blocks Phase 4.
- Spectro elements / result fields **(not specified)**; store raw file + parsed key/values **(inferred)**.

---

### Stage 5 — Cast close-out (tails) and logs out

| Aspect | Requirement |
|---|---|
| Actors | Supervisor or manager performs; foundry approves (§8.2) |
| Record | Cast `closed?` (§8.1); "cast close-out: tails" (§A.2 Move · Count column) |
| Rule | Close-out must explain the tail (§8.2 "Cast close-out (explain the tail)"); weekly question "which cast was closed with a tail nobody could explain" (§O.4) |

"Tail" = remaining unexplained kg of a cast when it closes **(inferred from §A.2 placing close-out beside Move · Count and §O.4's weekly question)**. The close-out should show: logs produced, billets consumed by press runs, bundles packed, rejects/ends/discard returned, unaccounted kg **(inferred)**.

---

### Stage 6 — Billets / logs in the billet store

| Aspect | Requirement |
|---|---|
| Station | Billet store (§A.2) |
| Actors | Anyone on the floor (Move) (§8.6; §8.2 "Move stock": floor operator, packer, supervisor, office) |
| Screen | **Move** (ખસેડો) (§8.6) |
| Record | Stock move: cast → billet store, timestamped, by whom (§A.2) |
| Ledger | Location move: same kg, new place (§A.2) |

Rules: logs tagged by cast; scan on the move (§A.2). Location "billet store" exists in Location master (§8.1). Move checks: location is not 0; item not dispatched (§8.6 Move).

Open: "cast = campaign? open" (§A.2, OI-08). Whether individual logs carry a label/QR **(not specified)**.

---

### Stage 7 — Log heater (multilog heater) and die oven

Document coverage is minimal: §A.2 press station lists "log heater · die oven"; §A.2 die room loop includes "die oven → press". No fields, screen, telemetry tags or records are specified for the heater **(not specified)**. Billet temperature appears among press telemetry ("pressure, speed, temps" per billet, §8.1 Billet event) — heater temperature may come via the PLC tags **(inferred)**. "Multilog" is not a term used by the document.

---

### Stage 8 — Press runs

| Aspect | Requirement |
|---|---|
| Station | Press (one press at Fourcubes, §A.1) |
| Actors | Press operator, supervisor (§8.2 "Press run, die in and out, downtime reason": press yes, supervisor yes); "op + supervisor sign" (§A.2) |
| Screen | **Press Run** (પ્રેસ) (§8.6) + wall Grafana in the cabin (§O.1, §3.2) |
| Paper replaced | The daily production data sheet (§O.2 10:00); operator copying speed/pressure/temperature off the HMI (§O.3) |
| Records | Press run and line (§8.1), Billet event (§8.1), Die weight reading (§8.1) |
| Ledger | − billets, + discard; ends + rejects return (§A.2) |

Press run (shift) fields (§8.1 Press run and line; §A.2 Press Run):

| Field | Unit | Typed / auto |
|---|---|---|
| shift | | typed/auto |
| operator, supervisor | FK users | sign (§A.2) |
| cast | FK Cast | typed (§8.6 "cast") |
| die instance | FK Die instance (oblique code) | typed: die in / out "one tap" (§O.2) |
| in / out | timestamps | die in / out taps |
| tier | die tier at run time | §A.2 "tier"; snapshot **(inferred)** |
| per-billet rows | Billet events | automatic from aggregator (Phase 7) |
| kg/12ft now vs last | kg/12ft | §A.2; die weight reading |
| downtime + reason | minutes + reason code | reason typed from code list (§8.6) |
| footer: discard, ends | kg | §A.2; "footer kg" (§8.6) |
| line: cut length, pcs, kg, recovery | inches, pcs, kg, % | Stage 9 |
| downtime, discard, ends, rejects | kg / min | §8.1 |

Billet event fields (§8.1, §6.1): press run, billet no, cast, pressure, speed, temps, cycle s, dead s, `is_historical`; "from the aggregator, not typed". ~600 billets a day (§6.1).

Validations (§8.6 Press Run): die exists; downtime reason from the code list. The reason code list itself **(not specified)**.

Telemetry (§6.1, §8.4) — Phase 7:
- PLC sampled at 1 Hz, ~20 tags, read-only, ~1.7M sample rows/day.
- Aggregator: billet = one ram stroke; idle > 10 min = downtime; shift rollups (billets, kg, downtime minutes, recovery).
- Press Run sheet auto-filled per shift; "operator adds the reason".
- Q-09: auto billet count within 2 % of operator count.
- Before Phase 7 the press sheet stays manual (R-01) — so every telemetry-derived field must also be typeable.

Links: press run → cast, die instance, die weight reading, billet events, cut lines, QC entries, bundles (bundle carries die instance and cast). Daily production report (§8.7) built from press run, billet events, bundles.

---

### Stage 9 — Stretch and cut

| Aspect | Requirement |
|---|---|
| Station | Stretch and cut (§A.2) |
| Actors | Cutting staff (§O.2 11:00) |
| Screen | **Cut** (કટિંગ) (§8.6); recorded as a Press Run line (§A.2 "app: Press Run line") |
| Paper replaced | (part of production sheet) |
| Ledger | + section-ends kg to Plant Scrap stream (§A.2) |

Fields: cut length (**inches**, §A.2 "cut length in inches"), pieces (counted), ends kg (section ends weighed) (§8.6, §A.2). Recovery % computed on the line (§A.2).

Validation (§8.6 Cut): **pieces × length ≤ pressed length**. Pressed length source **(not specified)** — from telemetry (ram strokes × extrusion length) or typed **(inferred)**.

Recovery definition: good kg out as a share of kg in (§12). Formula for the line **(inferred)**: recovery % = good kg / billet kg consumed × 100.

---

### Stage 10 — QC and rejects

| Aspect | Requirement |
|---|---|
| Actors | QC (§8.6) |
| Screen | **QC** (ક્યુસી) |
| Paper replaced | "The wastage list nobody reads"; "dated list today" (§O.2, §A.2) |
| Record | QC entry (§8.1): cast, die, reject kg, reason code + original remark |
| Ledger | − reject kg → Plant Scrap stream (§A.2) |

Fields: reject kg (wastage kg), reason (code), remark (free text kept as "original remark") (§8.6, §8.1, §A.2 "remark → reason code"). Linked to cast + die (§A.2).

Validation: reason code chosen (§8.6). Reject reason list is "a short list" (§O.2) **(contents not specified)**.

---

### Stage 11 — Ageing oven batches

| Aspect | Requirement |
|---|---|
| Station | Ageing oven (§A.2) |
| Actors | Ageing operator (§8.6) |
| Screen | **Ageing** (એજિંગ) / "Ageing Batch" (§A.2) |
| Record | Ageing batch (§8.1) |
| Ledger | No ledger line — process record (§A.2) |

Fields (§8.1, §8.6, §A.2):

| Field | Unit |
|---|---|
| gas start / end | gas meter reading (unit not specified) |
| temperature | °C **(inferred)** |
| shift | |
| in / out / total time | datetime, minutes |
| rows | cast, die, pcs, kg, hardness |
| PO number | carried on rows / batch (§8.1 "PO no carried", §A.2 "PO number carried") |

Validation: gas end ≥ gas start (§8.6).

Hardness unit **(not specified)** (Webster HW typical, **inferred**).

---

### Stage 12 — Packing, weighing and labelling (bundle creation)

| Aspect | Requirement |
|---|---|
| Station | Packing line (§A.2) |
| Actors | Packer; supervisor (§8.2 "Pack a bundle, print its label": packer yes, supervisor yes) |
| Screen | **Pack** (પેકિંગ) (§8.6) |
| Devices | Scale over RS-232 → phone (§3.2, §A.2); TSC label printer :9100 (TSPL2) driven by the print agent on the packing Pi (§6.1, ADR-007) |
| Paper / old flow replaced | Packer reads the scale, types weight, pieces, length into the office PC, prints, walks back (§O.3); "entered-not-weighed bundles" (Fig A-1) |
| Record | Bundle (§8.1, §A.2) + print job row (§6.1) |
| Ledger | + bundle kg at its location (§A.2) |

Bundle fields (§8.1, §A.2 Bundle 26I4086, §8.3 label):

| Field | Unit / format | Typed / auto |
|---|---|---|
| bundle no | `YY` + month letter A–L + seq, e.g. 26I4086 | system series |
| legacy cuid | 25-char cuid | legacy import only |
| section | FK Section (code e.g. 12170) | typed / picked |
| die instance | FK Die instance (oblique code e.g. 12170-1) | picked; mandatory (M5) |
| cast | FK Cast (K31) | picked |
| kg | kg, 2 dp on label (143.20) | **from the scale**, not typed |
| pcs | count | typed |
| length | ft + in (12 FT 0 IN on label); stored mm **(inferred)** | typed |
| kg/12ft | 3 dp on label (5.967) | computed: kg / pcs / ft × 12 (§A.2) |
| range | 1 dp (5.9) | computed: floor((kg/12ft + 0.01) × 10) / 10 (§8.8) |
| location | FK Location (yard 1–6) | "no default" (§6.1, §A.2) — must be chosen |
| status | **(values not specified)** | |
| packed by / at | user, timestamp | auto |
| PO | PO no (label shows "PO 31") | from order line |
| order line | FK SO line | "order line suggested" (§A.2) |

Validations (§8.6 Pack; §O.2 14:00):
- **kg/12ft within the die's band**, else a warning with the **nearest oblique** (die instance whose band matches) — "the phone says so before the label prints".
- Location must be chosen (no default) (§6.1, §A.2).
- After the label is printed the packer cannot change the weight; a wrong bundle is voided with a reason by a supervisor and repacked (§O.6, §8.2 "Void a bundle, reason required": supervisor, manager, plant admin).

Print path (§6.1 path B, ADR-007):
1. Operator taps → phone SQLite outbox with `clientMutationId`.
2. Core API (idempotent envelope, role checked, PIN user).
3. Postgres txn: bundle + ledger delta + audit + sequence.
4. Print job row: template id + variables; job id = idempotency key.
5. Mosquitto `fc/print/packing-1/jobs`, QoS 1 (may redeliver).
6. Print agent (Pi): SQLite outbox `UNIQUE(job id)`, parks until printable.
7. TSC printer :9100 TSPL2 prints.
8. Ack `fc/print/packing-1/acks` → `print_log`, replayed until the core confirms.

Print job state: `queued → sent → printed / failed` (§8.1). Phone shows "paper empty" via `GET /api/v1/print-jobs/{id}` (§8.4, §8.5).

Weekly measures: reprints and why; phone refusals at packing (§O.4) — reprint must carry a reason **(inferred from "why")**.

Volume: ~3,500 bundles/month (§A.1).

---

### Stage 13 — Yard locations and stock moves

| Aspect | Requirement |
|---|---|
| Station | Stock yard (§A.2) |
| Actors | Floor operator, packer, supervisor, office (§8.2 "Move stock, count stock") |
| Screen | **Move** (ખસેડો) (§8.6) |
| Record | Stock move (ledger entry pair, same kg new place) |

Locations (§8.1 Location): yard 1 to 6, billet store, scrap store; **no default** (§A.2 "loc 1–6 · no default"). Location 0 is not allowed (§8.6 Move "location is not 0") — legacy data uses 0 as unknown **(inferred)**.

Move validations (§8.6): location is not 0; bundle not dispatched.
Scan input: new bundle no QR, legacy cuid QR, or typed number (§8.3).

Reports: Stock by location — bundles and kg at yard 1 to 6, oldest first; live (§8.7).

---

### Stage 14 — Stock count and phantom check

| Aspect | Requirement |
|---|---|
| Actors | Yard, supervisor (§O.2 quarterly); §8.2 Move/count roles |
| Screen | **Count** (ગણતરી) (§8.6) — replaces the offline Stock Count tool on the ops PC (§A.2 legacy coexistence) |
| Record | Count checkpoint (§8.1): date, location, bundles seen; missing list → phantom report; "balance restarts here" |
| Frequency | Quarterly (§O.2); full count on cutover day (§A.4, R-05) |

Rules:
- Scan everything at a location; **missing list shown before close** (§8.6).
- Presence checkpoint "seen at location 3" (§A.2).
- Phantom check report: bundles in the system not seen at the last count, **by cast and by age**, after each count, "the same evening" (§8.7, §O.2).
- Target < 1 % phantom (Q-03, M1).
- "Balance restarts here" — a count checkpoint is a stock baseline for that location; later balances compute from it (§8.1, §A.2).
- Count accepts new number or old cuid (§A.2).

Phantom bundle = a bundle the system holds that is not in the yard at a count (§12).

---

### Stage 15 — Sales orders, baki and finishing

| Aspect | Requirement |
|---|---|
| Actors | Office, manager (create/edit); accountant read (§8.2 "Sales order and lines") |
| Screen | Office panel "app: Orders" (§A.2 Order book) |
| Paper replaced | ORDER FILE DINESH.xlsx (§O.2 18:00); "the ORDER FILE" closed in Phase 4 (§A.4) |
| Record | Sales order and line (§8.1) — **OUTBOX** write owner (only shared-edit table, edited on both sides) (§5.3, ADR-002) |

Fields (§8.1, §A.2, §6.2):

| Level | Field | Unit |
|---|---|---|
| Header | PO no | text |
| Header | customer | FK Customer |
| Header | finish | AND / PVD / 6061 (§6.2, §A.1) |
| Header | status | Confirm / Dispatch / Booking |
| Header | ship-to GSTIN | only when GSTN lifts advisory 668 (OI-10) |
| Line | die | FK (die / section) |
| Line | kg/12ft | kg/12ft |
| Line | length | ft/in |
| Line | pcs | count |
| Line | cast | (§A.2 order book line includes cast) |
| Line | produced, dispatched, baki | kg and pcs |

Baki (order balance) = kg and pcs still to dispatch on each order line (§12). Report "Order balance (baki)": per customer and line: ordered, produced, dispatched, remaining kg and pcs; live; built from SO lines, bundles, dispatch items (§8.7).

Planning: "Tomorrow's press plan is picked from what is still due" (§O.2 18:00); "orders running late" in the 7 am report (§O.2).

Finishing (OI-09): orders carry AND / PVD / 6061 but no anodise/PVD station exists. Options: in-house line, job-work out (needs job-work challan + return step before packing), or a note on the label. Changes §A.2 and the SO line. Blocks Phase 4. "6061" appears alongside finishes but is an alloy (Cast alloy 6063/6061, §A.2) — treat as an order attribute, likely alloy requirement **(inferred)**.

Plant: ~40 customers after dedupe (§A.2).

---

### Stage 16 — Dispatch, packing list and delivery note

| Aspect | Requirement |
|---|---|
| Station | Dispatch gate (§A.2) |
| Actors | Gate / packer scan; supervisor, office, manager complete (§8.2; §8.6 Dispatch "gate, packer") |
| Screen | **Dispatch** (ડિસ્પેચ) (§8.6); office panel for PL print |
| Paper / Excel replaced | Stock and Master.xlsx, move-to-sold step, manual total; gate scanning QR into Excel one by one and someone selecting the print range by hand (§O.2 16:00, §O.3) |
| Records | Dispatch and item; PL snapshot; Delivery Note (§8.1, §6.2) |
| Ledger | − bundle kg, sold, timestamped (§A.2) — on **DN submit** (ADR-004) |

Dispatch fields (§8.1, §8.6, §A.2): customer, vehicle (no), driver, driver photo / driver ID photo, scans (bundles), item: bundle + SO line. State `draft → reserved → completed` (§8.1).

PL snapshot (§8.1, §6.2): PL no (from the plant's book, §8.8), 11 columns, totals, range/12'; header with customer, vehicle, PL number, date; PO no and Inv no linked. The 11 column names **(not specified)**.

Delivery Note (§6.2, §8.1): internal, not printed; **submit = stock out**; sets the dispatch timestamp. No challan exists.

Validations (§8.6 Dispatch; ADR-004):
- Bundle not already on another PL.
- Order line suggested per bundle.
- "Yard scan, die by die; bundles reserved; old cuid QR accepted" (§6.2).
- Gate scans every bundle before the truck leaves (ADR-004).

Truck carries: the PL with bundle detail + tax invoice in three copies, each followed by its e-way bill page (§6.2).

Offline: scans held on the phone, PL builds when back (yard Wi-Fi down); dispatch works with internet down (§8.5).

---

### Stage 17 — Tax invoice, IRN, e-way bill, Tally

See §7 of this digest for the full flow. Summary:
- Actors: office and manager (create); manager and plant admin cancel IRN; accountant reads (§8.2).
- Today Tally on the ops PC issues invoice, IRN and EWB (§A.1, ADR-012, OI-07).
- Proposed: orrn issues invoice (series no per FY, never reused; HSN, POS, CGST/SGST/IGST; line → DN line; docstatus) (§8.1), IRN via IRIS IRP, EWB via ASP, Tally XML monthly for the CA.
- Offline: proforma prints; final invoice after IRN (§6.2, §8.5).

---

### Stage 18 — Central store: MRS, GRN, spares

| Aspect | Requirement |
|---|---|
| Actors | Storekeeper only (§8.2 "Store issue (MRS), receipt (GRN)") — owner of the store screen (§O.5) |
| Screen | **Store** (સ્ટોર) (§8.6); operator app gets store issue/receipt for the storekeeper role (§7.1) |
| Paper replaced | MRS and GRN on paper; opening/closing by memory (§O.3) |
| Records | Store item, MRS, GRN (§8.1), plant-owned |
| SOP | Hindi SOP already written (Lalubhai) (§A.2) |

Fields: chemicals, LDO, gas, spares (items); open / used / close per form; old-for-new exchange (spares) (§8.1, §8.6, §A.2).

Validations: **stock cannot go negative** (§8.6, §O.3).

Feeds: foundry chemicals, LDO, nitriding chemicals, gas (§A.2). Foundry yield uses store issues for LDO per tonne (§8.7).

Reconciliation: GRN ↔ vendor bill via AI reconciliation (§5.3, §8.7).

---

### Stage 19 — Die room: die card, nitriding, weight readings, tiers, drift

| Aspect | Requirement |
|---|---|
| Actors | Die room (die card, nitriding, re-rank tiers), press and supervisor (weight reading), manager approves re-rank (§8.2) |
| Screens | **Die Card** (ડાઈ કાર્ડ), **Nitriding** (નાઇટ્રાઇડિંગ) (§8.6) |
| Paper replaced | Die card and nitriding sheet on paper; "nobody knows which oblique is heavier this month" (§O.3) |
| Loop | supplier → tool room → nitriding → die oven → press → back (§A.2) |

Die Card fields (§8.6, §A.2, §8.1 Die instance): supplier, die code / oblique code, range/12', trial kg, hardness, life, FTR, status in / out / retired, tier rank (mutable, dated).
- Validation: **oblique code unique for the section** (§8.6).
- Oblique code is permanent (e.g. 12170-1) (§8.1, §A.2).
- FTR meaning **(not specified)** (first trial result **inferred**).

Nitriding log (§8.1, §8.6, §A.2): die instance, date, hardness, chemicals CR4, CR2, K2S, caustic soda with open / used / close, signed by.
- Validation: **close = open − used** (§8.6).

Die weight reading (§8.1): die instance, press run, current vs last kg/12ft; feeds tier suggestion. Taken by press, supervisor or die room (§8.2).

Tier (§12, §8.1, Fig 8-1):
- A die's weight rank among copies of its section; re-ranked in the die room (and nowhere else, Fig A-1); manager approves re-rank (§8.2).
- Tier is **not printed on the label**; the floor uses the oblique code (§8.3).
- Section (cloud) holds "design kg/12ft, tier bands" (§8.1); die instance (plant) holds tier rank.
- System "suggests which copy to run first" (§O.3).

Die drift report (§8.7): kg/12ft trend per die instance, tier suggestion, dies past their life; weekly. Target: die never found heavy by the customer before the plant (M8).

---

### Stage 20 — Reports and office outputs

All reports are queries over the ledger and records, not maintained spreadsheets (§8.7). Served as JSON and xlsx via `GET /api/v1/reports/{name}` on box and cloud (§8.4). Daily ones land in the manager's WhatsApp at 7 am from the cloud (§8.7).

| Report | Answers | Built from | When |
|---|---|---|---|
| Daily production | kg and pcs by section, recovery %, downtime minutes and reasons | press run, billet events, bundles | daily |
| Stock by location | bundles and kg at yard 1–6, oldest first | bundles, ledger | live |
| Phantom check | bundles in system not seen at last count, by cast and age | count checkpoints, bundles | after each count |
| Order balance (baki) | per customer and line: ordered, produced, dispatched, remaining kg and pcs | SO lines, bundles, dispatch items | live |
| Die drift | kg/12ft trend per die instance, tier suggestion, dies past life | die weight readings, bundles | weekly |
| Cast traceability | for one cast: lots in, spectro, billets, bundles, customers | everything with a cast id | on demand |
| Foundry yield | kg in by stream, logs out, dross, burn loss %, LDO per tonne | casts, store issues | daily |
| Purchase register | lots by vendor, party vs FC kg, D/C notes, rate trend, recovery by vendor | purchase lots, casts | monthly |
| Dispatch register | PLs and invoices by customer, EWB status and expiry | dispatches, invoices, EWB log | live |
| Reconciliation | PL vs invoice kg, receipt vs vendor bill kg, unresolved names | AI reconciliation queue | daily |
| GST | GSTR-1 and 3B JSON, e-invoice register, unreported invoices nearing 30 days | invoices, e-invoice log | monthly, alert daily |
| Label audit | jobs queued, printed, failed, reprinted, by printer and packer | print log | weekly |

7 am report content (§O.2 7:00): yesterday's kg pressed, recovery, press stops, bundles packed, trucks out, orders running late, stock by yard. Delivered on the owner's phone via WhatsApp (§3.1). Exit criterion of Phase 8: the manager reads it from home (§A.4).

Month end (§O.2): GST return file, Tally export, purchase register with debit and credit notes, die report — "ready to send, not to prepare". GSTR filing needs an OTP so it stays a person's click in the panel (§6.2).

"Die report" at month end = die drift report **(inferred)**.


---

## 3. Entity map (§8.1)

§8.1 draws 35 entity boxes in six groups; several boxes are more than one table (about 48 tables when split). Write owner per box: PLANT (written on the box, replicated up), CLOUD (written in the cloud, replicated down), OUTBOX (shared, idempotent outbox), BOTH (audit). "Fields are the ones that matter for this document, not the full schema" (§8.1 note).

All plant tables use UUIDv7 keys (§5.2) and carry `tenant_id`; cloud unique indexes are composite on `(tenant_id, …)` (§5.3).

### 3.1 Purchase

| Entity | Owner | Key fields (§8.1) | Relationships |
|---|---|---|---|
| Vendor | CLOUD | name, resolved aliases, GSTIN or unregistered, usual items, last rates. "K in name = broker, not kept" | 1→n Purchase lot |
| Purchase lot | PLANT | vendor, date, origin, grade, quality, party kg, FC kg, rate, dross %, photos, bill book, status BOOKING → UNLOAD → OK | n→1 Vendor; 1→n D/C note; "draws kg" into Cast |
| Debit / credit note | PLANT | lot, kg difference, 0.5 % tolerance, bori deduction, approved by the manager | n→1 Purchase lot |
| Scrap item and grade | CLOUD | items (imp belling, soft cable, …), grade A+/A/B/C, expected recovery % | referenced by Purchase lot |
| Return stream | CLOUD | ingot, plant scrap, discard, dross ingot, bend log, hill metal, pit, tendis, dross metal | Cast inputs; receives ends/rejects/discard |
| Store item, MRS, GRN | PLANT | chemicals, LDO, gas, spares; open/used/close per form; old-for-new exchange | issues feed Cast, Nitriding |

### 3.2 Foundry and press

| Entity | Owner | Key fields | Relationships |
|---|---|---|---|
| Cast | PLANT | year, month, seq → "K31"; alloy, grade, timestamps; inputs: lots + return streams; logs out, spectro file, closed? | ← lots, streams; 1→n Billet event, Press run, Bundle, QC entry, Ageing rows. ADR-013: campaign with melts under it (proposed) |
| Billet event | PLANT | press run, billet no, cast, pressure, speed, temps, cycle s, dead s, is_historical; from the aggregator, not typed | n→1 Press run, Cast |
| Press run and line | PLANT | shift, operator, supervisor, cast, die instance, in / out timeline; line: cut length, pcs, kg, recovery; downtime, discard, ends, rejects | n→1 Cast, Die instance ("die in"); 1→n Billet event; 1→n Die weight reading |
| QC entry | PLANT | cast, die, reject kg, reason code + original remark | n→1 Cast, Die instance |
| Ageing batch | PLANT | gas start / end, temp, shift; rows: cast, die, pcs, kg, hardness; PO no carried | rows n→1 Cast, Die instance |
| telemetry.samples | PLANT | ts, machine, tag, value; raw 1 Hz, 90 days, never replicated; shift rollups replicate up | n→1 Machine |

### 3.3 Dies

| Entity | Owner | Key fields | Relationships |
|---|---|---|---|
| Section (catalogue) | CLOUD | code 12170, series Domal, design kg/12ft, tier bands, HSN, drawing, thickness | 1→n Die instance ("1 → n obliques") |
| Die instance | PLANT | oblique code 12170-1 (permanent), tier rank (mutable, dated), supplier, trial kg, hardness, life, FTR, status in / out / retired | n→1 Section; 1→n Die weight reading ("tier evidence"), Nitriding log, Press run, Bundle |
| Die weight reading | PLANT | die instance, press run, current vs last kg/12ft; feeds tier suggestion | n→1 Die instance, Press run |
| Nitriding log | PLANT | die instance, date, hardness, CR4, CR2, K2S, caustic soda, signed by | n→1 Die instance |
| Machine | PLANT | press, furnace, oven, scale; PLC address, tag map; collector device | 1→n telemetry.samples; ↔ Device |

Why section is cloud and die instance is plant: tier is re-ranked on the floor (Fig 8-1).

### 3.4 Stock

| Entity | Owner | Key fields | Relationships |
|---|---|---|---|
| Stock ledger entry | PLANT | voucher type, voucher no, line, item / bundle, location, kg delta, posting time + creation tiebreak, is_cancelled, reversal as a set | references any document; "+ kg / − kg" from Bundle (pack) and DN (dispatch) |
| Bundle | PLANT | no 26I4086, legacy cuid, section, die instance, cast, kg, pcs, length, kg/12ft, range, location, status, packed by / at | n→1 Section, Die instance, Cast, Location; 1→n Print job ("label"); "seen at" Count checkpoint; "scanned" onto Dispatch item |
| Print job and log | PLANT | job id = idempotency key, printer, template, variables; queued → sent → printed / failed | n→1 Bundle, Label template |
| Location | PLANT | yard 1 to 6, billet store, scrap store; no default | 1→n Bundle, ledger entries |
| Count checkpoint | PLANT | date, location, bundles seen; missing list → phantom report; balance restarts here | n→1 Location; n↔n Bundle |
| Label template | CLOUD | versioned TSPL2 layout, variables, QR contract | 1→n Print job |

Ledger ordering key: posting time, then creation tiebreak (§8.1). Cancellation: `is_cancelled` flag + reversal rows as a set — never update kg (ADR-003).

### 3.5 Sales

| Entity | Owner | Key fields | Relationships |
|---|---|---|---|
| Customer, ship-to | CLOUD | name, aliases, GSTIN, bill-to, ship-to addresses, kg tolerance, price list | 1→n Sales order, Dispatch |
| Sales order and line | OUTBOX | PO no, customer, finish; line: die, kg/12ft, length, pcs; produced, dispatched, baki; status Confirm / Dispatch / Booking | n→1 Customer; line ← Dispatch item ("fulfils") |
| Dispatch and item | PLANT | customer, vehicle, driver; item: bundle, SO line; draft → reserved → completed | n→1 Customer; item n→1 Bundle, SO line; 1→1 PL snapshot / DN ("submit") |
| PL snapshot, Delivery Note | PLANT | PL no, 11 columns, totals; DN submit = ledger out; dispatch timestamp | n→1 Dispatch; DN line ← Invoice line |
| Invoice and line | PLANT | series no per FY, never reused; HSN, POS, cgst / sgst / igst; line → DN line; docstatus | 1→1 e_invoice_log ("IRN") |
| e_invoice_log, e_waybill_log | CLOUD | IRN, ack no / dt, signed JSON; EWB no, valid_upto, extensions; status Pending → Auto-Retry → … | n→1 Invoice |

Note (Fig 5-2): the signed invoice JSON is a cloud-owned row replicating down, which is how the plant prints the QR without asking the IRP again.

### 3.6 Platform

| Entity | Owner | Key fields | Relationships |
|---|---|---|---|
| Tenant | CLOUD | host fourcubes.orrn.in, GSTINs, e-invoice applicable, plant boxes, settings | 1→n everything |
| User, role, PIN | CLOUD | many tenants per person; role set per tenant; PIN for the floor, email for office | "actor" on Audit log |
| Audit log | BOTH | actor, impersonator, device, subject, before / after, txn; DB trigger, append-only | |
| Device | PLANT | phone, Pi, printer, PLC; paired by QR, station, token; last seen, app version | |
| Mutation log (outbox) | PLANT | clientMutationId unique; applied at, result, replay-safe | n→1 Device |
| Series counter | PLANT | tenant, doc type, prefix, FY; UPDATE … RETURNING, no reuse | |

Cloud-owned list per §5.3: tenants, users, price lists, GST masters, section catalogue (tier bands), e-invoice + EWB logs. Plant-owned (dies, casts, bundles) arrive read-only. Shared-edit (sales orders) use an outbox.

### 3.7 Identity and numbering schemes

| Thing | Scheme | Example | Source |
|---|---|---|---|
| Bundle number | 2-digit year + month letter A–L + sequence of 1–5 digits. Regex `^\d{2}[A-L]\d{1,5}$` | 26I4086 (2026, I = September, seq 4086) | §8.3, §8.8 |
| Bundle number, old style | month letter + seq without year; typed entry "asks for the year". Regex `^[A-L]\d{1,5}$` | J540 ("500 numbered J540-style", §A.2) | §8.3 |
| Legacy bundle id | 25-char cuid, resolved through a legacy map to a bundle | cmtibj86a00jvr101p2348h5o | §8.3, §A.2 |
| Month letter | A = Jan … L = Dec **(inferred from I = Sep on the sample label dated 13-09-26)** | I | §8.3 |
| Bundle seq reset | **(not specified)**; 4086 in September at ~3,500 bundles/month suggests reset per month or per year **(inferred, verify)** | | |
| Cast number | stored (year, month, seq); shown as month letter + seq; year not written | K31, H24 | §8.1, §8.8, OI-08 |
| PL number | from the plant's book (existing PL book series) | **(format not specified)** | §8.8 |
| Invoice number | series per FY, never reused | **(format not specified)** | §8.1 |
| Section code | numeric catalogue code + series name | 12170, Domal | §8.1 |
| Oblique code | section code + "-" + copy number; permanent; unique per section | 12170-1 | §8.1, §8.6 |
| Series counter | per (tenant, doc type, prefix, FY); `UPDATE … RETURNING`; never decremented, no reuse | | §5.2, §8.1 |
| Row ids | UUIDv7 | | §5.2 |
| Mutation id | `clientMutationId`, unique | | §6.1, §8.1 |
| Print job id | idempotency key on core and agent | | §6.1, ADR-007 |
| IDs in the document | ADR, OI, Q, R numbers only go up, never reused | | §0.4 |

### 3.8 Units and formulas (§8.8, §A.2)

- Weight: kilograms throughout.
- kg/12ft = kg / pcs / length_ft × 12 (§A.2 "kg/12ft: kg/pcs/ft×12").
- Weight range (billed on) = floor((kg/12ft + 0.01) × 10) / 10 (§8.8, §12, Fig A-1).
- Cut length entered in inches (§A.2); label prints ft + in.
- LDO in tank inches (§12).
- Money: rupees with Indian grouping (₹1,00,000; ₹10 Cr). Dates as "22 Sep 2026"; times IST (§8.8).
- Recovery = good kg out / kg in (§12).

---

## 4. Roles and permissions (§8.2, ADR-010, §A.3)

One list of actions, one set per role, checked by the server and used by the app to hide what a person cannot do (§8.2). `permissions.ts` shared between core and app (§5.2). "Approve" = action needs that role's sign-off to submit. "read" = see only. The old orrn role table stopped operators creating receipts; fixed here (§8.2).

### 4.1 Role list (12)

Station roles (floor, PIN on shared phones): Floor operator, Packer, Foundry, Press, Supervisor, Storekeeper, Die room.
Office roles (web panel, email login): Office, Manager, Plant admin, Accountant.
Platform: orrn staff.
(Station/office split is the digest's grouping from §A.3 "PIN for the floor, email for office" in §8.1 User box.)

### 4.2 Matrix (verbatim from §8.2; blank = not allowed)

| Action | Floor op | Packer | Foundry | Press | Supervisor | Storekeeper | Die room | Office | Manager | Plant admin | Accountant | orrn staff |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pack a bundle, print its label | | yes | | | yes | | | | | | | |
| Void a bundle, reason required | | | | | yes | | | | yes | yes | | |
| Move stock, count stock | yes | yes | | | yes | | | yes | | | | |
| Scan bundles onto a packing list | yes | yes | | | yes | | | yes | | | | |
| Complete a dispatch (stock out, timestamp) | | | | | yes | | | yes | yes | | | |
| Cast entry, spectro attach | | | yes | | yes | | | | | | | |
| Cast close-out (explain the tail) | | | approve | | yes | | | | yes | | | |
| Press run, die in and out, downtime reason | | | | yes | yes | | | | | | | |
| Die weight reading | | | | yes | yes | | yes | | | | | |
| Nitriding log, die card | | | | | | | yes | | | | | |
| Re-rank die tiers | | | | | | | yes | | approve | | | |
| Purchase receipt, party vs FC kanta | yes | | | | | yes | | yes | | | | |
| Debit or credit note on a scrap lot | | | | | | | | yes | approve | | read | |
| Store issue (MRS), receipt (GRN) | | | | | | yes | | | | | | |
| Sales order and lines | | | | | | | | yes | yes | | read | |
| Tax invoice, IRN, e-way bill | | | | | | | | yes | yes | | read | |
| Cancel an IRN (inside 24 h, no EWB) | | | | | | | | | yes | yes | | |
| Masters: customers, vendors, sections, prices | | | | | | | | draft | yes | yes | | |
| Users, PINs, phones, printers | | | | | | | | | | yes | | |
| Restore a backup, update the box | | | | | | | | | | yes | | yes |
| GST returns JSON, Tally export | | | | | | | | yes | | | yes | |
| Reports | | | | | read | | | read | read | read | read | |
| Act as a tenant user (time-boxed, audited) | | | | | | | | | | | | yes |

Matrix notes:
- 22 actions × 12 roles.
- Station roles (QC, ageing, cutting) are not separate columns; the QC, Ageing and Cut screens (§8.6) have no explicit row in §8.2. Assigning them to Press / Supervisor or a Floor operator role is **(not specified)**.
- Masters "draft" for Office means office can propose, manager/plant admin publish **(inferred)**.
- Every submit writes an audit row with actor and, when orrn staff act as someone, the impersonator (§8.2).
- A person can belong to more than one plant; the accountant usually does (§8.2, §8.1 "many tenants per person; role set per tenant").

### 4.3 Login, devices and pairing (ADR-010, §A.3, §8.4)

- A phone is paired to a **station**, not a person (Fig A-2). People sign in with a PIN on whichever phone is at hand (ADR-010).
- Pairing steps (§A.3):
  1. Admin makes a QR in the panel, per station: LAN URL + public URL + one-time device token.
  2. App scans it; tries the LAN URL first, falls back to the tunnel.
  3. Box registers device id, station, name; issues a long-lived device key; token burned.
  4. Operator PIN: 4 to 6 digits, per person; role set comes with it; **locks after 8 hours** (session).
  5. Masters cached: sections, dies, open casts, customers, open orders; **delta sync every minute**.
  6. Works offline: writes to the outbox, replayed in order; badge shows the queue.
- `POST /api/v1/auth/pin`: PIN + device key → short session token with the role set (§8.4).
- Lost phone: revoked in the panel; device key stops on next request; its unsent outbox is lost (hence the badge) (§A.3).
- Office users: email login (§8.1).
- OI-06 (shared vs personal phones) changes PIN login and pairing, not the architecture. §O.5: "shared phones are simpler".
- OI-11: plant admin to be named; §O.5 suggests Dinesh in the office.
- Seven phones, one per station: scrap yard, foundry, press and die room, QC and ageing, packing, yard, gate (§O.1, §O.5, §A.1).
- orrn staff impersonation: time-boxed, audited, logged with name (§8.2, §O.6).

---

## 5. Bundle label and QR (§8.3, ADR-005)

### 5.1 Label

- One label per bundle, printed at packing the moment the weight is stable (§8.3).
- Size 100 × 50 mm, 203 dpi (8 dots/mm), gap 3 mm, TSPL2 on a TSC printer :9100 (§8.3, §A.3).
- QR: 30 mm, error correction level H.
- Tier is deliberately **not** on the label; the floor uses the oblique code (§8.3).
- Every element is test-printed on the plant's TSC before the template is versioned; "the old spool's barcode commands were never run against a printer" (§8.3). Printer status bytes re-derived from the TSC manual are technical debt until verified on the packing printer in Phase 2 (§11.3).

Content lines (sample, §8.3):

```
26I4086                                  <- bundle no, large (font scale 3)
12170-1 DOMAL 12170                      <- oblique code, series, section code
143.20 KG 24 PCS 12 FT 0 IN              <- kg (2 dp), pcs, length ft+in
KG/12FT 5.967 RANGE 5.9                  <- kg/12ft (3 dp), range (1 dp)
CAST K31 PO 31 13-09-26                  <- cast, PO, date DD-MM-YY
FOURCUBES · fourcubes.orrn.in/b/26I4086  <- tenant name + QR URL text
[QR 30 mm, level H]
```

TSPL2 (as printed in §8.3):

```
SIZE 100 mm,50 mm
GAP 3 mm,0 mm
DIRECTION 1
CLS
TEXT 24,24,"0",0,3,3,"26I4086"
TEXT 24,110,"0",0,1,1,"12170-1 DOMAL 12170"
TEXT 24,150,"0",0,1,1,"143.20 KG 24 PCS 12 FT"
TEXT 24,190,"0",0,1,1,"KG/12FT 5.967 RANGE 5.9"
TEXT 24,230,"0",0,1,1,"CAST K31 PO 31 13-09-26"
QRCODE 560,60,H,8,A,0,"https://fourcubes.orrn.in/b/26I4086"
PRINT 1,1
```

Label template entity: cloud-owned, versioned TSPL2 layout, variables, QR contract (§8.1).

### 5.2 QR contract (ADR-005)

| Input | Format | Resolution |
|---|---|---|
| New labels | `https://{tenant}.orrn.in/b/{bundle no}` | last path segment is the bundle no; with no app, the page `/b/{no}` shows the bundle (box and cloud) |
| Old labels (until sold) | 25-char cuid, e.g. `cmtibj86a00jvr101p2348h5o` | legacy map → bundle |
| Typed by hand | `^\d{2}[A-L]\d{1,5}$` or `^[A-L]\d{1,5}$` | old style without year prompts for the year |

- QR carries the bundle number only; weight and section are printed for people and looked up for machines, so a reprint after a correction never leaves a stale number in the code (Fig 8-2).
- Consequence: any phone camera opens a bundle; a scan needs the box or cloud to answer (ADR-005).
- `GET /api/v1/bundles/{code}` resolves a bundle no or a legacy cuid; callers app, browser, QR gun (§8.4).
- Old QR accepted at Dispatch, Move and Count until the last old-label bundle is sold (§6.2, §A.2, §11.3).
- Legacy coexistence: ~2,500 bundles in the yard carry cuid QR labels, 500 numbered J540-style (§A.2).

---

## 6. Topics, endpoints and edge architecture

### 6.1 MQTT topics (§8.4)

| Topic | Publisher | Subscribers | QoS · retained | Payload |
|---|---|---|---|---|
| fc/press/1/birth | cabin Pi | aggregator, Grafana | 1 · retained | metric names, types, units; sent on every reconnect |
| fc/press/1/tags | cabin Pi | aggregator | 1 · no | ts, 20 tag values, is_historical when replayed from the Pi's disk |
| fc/press/1/health | cabin Pi | core, cloud bridge | 1 · retained | up, PLC reachable, buffer depth, version |
| fc/print/packing-1/jobs | core | packing Pi | 1 · no | job id, template version, variables, copies |
| fc/print/packing-1/acks | packing Pi | core | 1 · no | job id, printed at or error, replayed until acked |
| fc/print/packing-1/status | packing Pi | core, cloud bridge | 1 · retained | printer state, media, ribbon, head, from the 4-byte status probe |
| fc/box/health | core | cloud bridge | 1 · retained | version, disk, replication lag, outbox depth |
| fc/shift/rollup | aggregator | cloud bridge | 1 · no | per shift: billets, kg, downtime minutes, recovery |

Mosquitto: :1883, persistence on, max_queued_messages 200k, bridge to cloud QoS 1 cleansession off, per-device user and password, Pis only (§5.2, §7.1, §A.3).

### 6.2 HTTP endpoints (§8.4)

| Endpoint | On | Caller | Does |
|---|---|---|---|
| POST /api/v1/auth/pin | box | app | PIN + device key → short session token with role set |
| POST /api/v1/mutations | box | app, watcher | one envelope for every write: clientMutationId, type, payload; replay returns first result |
| GET /api/v1/sync/masters?since= | box | app | sections, dies, casts, customers, orders changed since |
| GET /api/v1/bundles/{code} | box | app, browser, QR gun | resolves bundle no or legacy cuid |
| GET /b/{no} | box and cloud | any phone camera | page behind the QR |
| GET /api/v1/print-jobs/{id} | box | app | label state, for the "paper empty" message |
| GET /api/v1/reports/{name} | box and cloud | panel | §8.7 reports as JSON and xlsx |
| POST /gst/v1/invoices/{id}/irn | cloud, Indian VPS | panel | queue an IRN request; status polls the log |
| POST /gst/v1/ewb/{id}/part-b | cloud, Indian VPS | panel, app at the gate | vehicle number onto an e-way bill |
| GET /ai/v1/resolve?type=&q= | cloud | panel, app when online | free text → master id and confidence |
| POST /ai/v1/extract | cloud | panel | photo → record ids into the review queue |

### 6.3 Plant box internals (§5.2, §7.1)

- Hardware: mini PC 32 GB / 1 TB SSD, Debian, on a UPS with the router and 3 APs, in the office, static LAN IP 192.168.10.2 (§5.2, §A.3). ~₹70k–90k (§O.5).
- orrn core (TypeScript): :443 on LAN with TLS; REST + realtime; idempotent mutation envelope; `permissions.ts` shared with the app; audit written in the same transaction; serves the web panel; series counters never decremented.
- Postgres 16: schema `plant` (dies, casts, runs, bundles, PL, ledger; docstatus; audit triggers; UUIDv7); schema `telemetry` (Timescale Community, raw 1 Hz, 90 days, compressed after 7); publication to cloud over Tailscale; no table has two writers.
- Mosquitto :1883; aggregator (Go: billet = ram stroke, shift rollups, downtime detection); Grafana :3000 for the cabin wall.
- Tailscale (replication, remote access, fleet updates); cloudflared (browser access only).
- Backup: nightly pg_dump → age-encrypted → R2; restore drill done; secrets (printer, PLC, MQTT credentials) encrypted under a key not in the backup (§A.3).

### 6.4 Edge agents (§6.1, §7.1)

| Agent | Runs on | Built with | Owns |
|---|---|---|---|
| PLC collector | Pi in press cabin (box if PLC port shared, OI-05) | Go; Modbus TCP / S7 (gos7) / OPC UA; retained birth; is_historical; buffers to disk | telemetry.samples |
| aggregator | plant box | Go worker | press_run_billet, shift rollups |
| print agent | Pi at packing | Go static arm64; SQLite outbox; TSPL2; idempotent on job id; one goroutine per printer; park until printable | print_jobs (local), print_log acks |
| spectro watcher | spectro PC (Windows) | Go; folder watch; CSV parse; HTTP to the core | cast.spectro |
| operator app | Android/iOS | Expo; expo-sqlite; upload queue; PIN; pairing QR; Hindi | its own outbox |

### 6.5 Two data paths (§6.1)

- Path A telemetry (blue): PLC (read-only) → collector (cabin Pi, Modbus/S7/OPC UA, retained birth) → Mosquitto `fc/press/1/tags` (QoS 1, persisted) → `telemetry.samples` (Timescale, 90 days, `is_historical` on replay) → aggregator (billet = one ram stroke; idle > 10 min = downtime) → `press_run_billet` (one row per billet: pressure, speed, temps) → Press Run sheet auto-filled per shift (operator adds the reason). 1 Hz · ~20 tags; ~1.7M rows/day; ~600 billets/day. Also feeds Grafana.
- Path B transaction (amber): see Stage 12. Failure holds: Wi-Fi down → stays in phone outbox; no default location; paper out → job waits.
- "Neither path leaves the plant."

### 6.6 Cloud side (§5.3)

- One multi-tenant Postgres, Indian region; `tenant_id` on every row; RLS enabled and forced on every table; app role NOSUPERUSER NOBYPASSRLS, owns nothing; CI fails on a table without enable + force + policy; composite unique indexes on (tenant_id, …); PgBouncer transaction mode with `SET LOCAL app.tenant_id` (deferred to second tenant, OI-04); monthly partitions for rollups; no Timescale in cloud; pgvector per tenant partition, HNSW per partition.
- Replication: plant box → cloud, a Postgres subscription per box (plant tables) over Tailscale + Mosquitto bridge (aggregates, device health). Cloud → plant box: a second subscription (tenant config, users, masters, e-invoice and EWB logs).
- Web panel `[tenant].orrn.in`: Host header → tenant; same API contract as the app; office staff, manager, plant admin, accountant.
- Documents out: PL + invoice PDF to customers via WhatsApp or email; Tally XML for the CA; GSTR-1 / 3B JSON for the portal; signed QR printed on the invoice.
- GST egress (Indian VPS, static IP): IRP adapter (IRIS; "Clear" also named in §7.1), ASP adapter (EWB), retry worker every 5 min, e_invoice_log, e_waybill_log, IRN cancel ≤ 24 h never after EWB, report ≤ 30 d if AATO ≥ ₹10 Cr, EWB valid_upto stored, extend ± 8 h, bulk-JSON fallback, secrets masked. ~₹2,000/month + a few paise per EWB (§O.5).
- AI service: resolver (free text → master id + score); extraction (photo → record ids, queue); reconciliation (PL ↔ invoice, GRN ↔ bill); answers in Hindi / Gujarati by tool calls; retrieval inside the tenant partition; unavailable offline; floor never waits; calls Claude API with the user's own token (ADR-011).
- Ops: Tailscale fleet, health dashboard, box update rollout, restore drill (dump → spare box; outboxes fill the gap after restore), demo.orrn.in tenant for store review, R2 for encrypted dumps and label photos, one app listing; tenant chosen by pairing QR.

### 6.7 Network (§A.3, ADR-014, ADR-015)

| Device | Address | Network | Notes |
|---|---|---|---|
| Router | 192.168.10.1 | plant LAN | DHCP for phones, reservations otherwise, split DNS |
| Plant box | 192.168.10.2 | LAN + Tailscale | fourcubes.orrn.in resolves here inside the plant |
| Cabin Pi (collector) | 192.168.10.11 · 192.168.20.11 | LAN + PLC segment | only device on both |
| Packing Pi (print agent) | 192.168.10.12 | LAN | owns the printers |
| TSC printer packing-1 | 192.168.10.21 | LAN | :9100, reachable from packing Pi only |
| Press PLC | 192.168.20.31 | PLC segment | read-only from the Pi; no route to LAN |
| Spectro PC | 192.168.10.41 | LAN | watcher posts to the box |
| Ops PC (Tally, QR gun) | 192.168.10.42 | LAN + Tailscale | keeps working through cutover |
| Legacy fcms_db (Proxmox) | 20.0.0.120 | Tailscale | read-only after import |
| Phones | 192.168.10.100–.199 | Wi-Fi WPA2 plant SSID | paired by QR, PIN login |

Ports: 443 box (phones, office, Pis); 1883 box (Pis only); 5432 box (Tailscale only); 3000 box (cabin wall); 9100 printer (packing Pi); 502 / 102 / 4840 PLC (Modbus TCP / S7 / OPC UA, one of them); 41641 UDP out (Tailscale); 7844 out (cloudflared); no inbound port forwards ever.
TLS: real certificate for fourcubes.orrn.in through a DNS challenge; valid padlock on LAN with nothing installed; renewal needs internet once every 60 days and fails safe.

### 6.8 Fault matrix (§8.5)

works = no one acts; queues = held durably and replays; stops = someone must act.

| Fault | Pack and print labels | Scan to PL, dispatch | Press sheet auto-fill | Office web panel | IRN and e-way bill | Remote access, backup | AI helpers |
|---|---|---|---|---|---|---|---|
| Internet down (weekly, hours) | works | works | works | works — fourcubes.orrn.in resolves to the box on LAN; master edits wait | queues — proforma prints; final invoice after IRN; 30-day ceiling for ≥ ₹10 Cr; bulk-JSON EWB fallback | queues — bridge and replication catch up; backup retries | queues |
| Yard Wi-Fi down (one AP) | queues — phone outbox holds packs; label prints when phone reconnects | queues — scans held on phone, PL builds when back | works — press is wired | works | works | works | works |
| Printer paper out / head open | queues — job parks on agent; phone shows "paper empty"; resumes by itself | works | works | works | works | works | works |
| Plant box down (disk, PSU) | queues — phones keep packing into outbox; no labels until spare is up | queues | queues — cabin Pi buffers to disk | stops — cloud panel shows last replicated state, read only | works — cloud side, for invoices already replicated | stops — restore last night's dump onto the spare | works |
| Cloud down (rare) | works | works | works | works on LAN only | queues | queues | stops |
| Power cut (UPS ~20 min) | queues — box, router, APs on UPS; printers dark; press dark | works — phones and box up 20 min, then phones queue | stops — press is off; the gap is real, not missing data | works 20 min, then waits | works | works | works |

FAQ answers that are requirements (§O.6): office computer dies → nightly locked copy; spare computer gets last night's copy in an hour; phones hold the morning's work and replay. Internet down a week → packing, dispatch, press, stock carry on; invoices print as proforma and get IRN when the line returns; e-way bills can be uploaded from any phone on mobile data.

### 6.9 What cannot run on the current Cloudflare-only stack vs what can be modelled now

The current repo: Cloudflare Workers + D1 (SQLite) + tRPC, React web, Expo native, an "edge node" deployment record (`spool_deployment`) with Cloudflare Tunnel tokens, and a print spool integration. Assessment below is the digest's **(inferred)** analysis against the document.

Cannot run on Workers + D1 alone (needs the plant box or other non-Workers infrastructure):

| Capability | Why | Doc ref |
|---|---|---|
| Plant box as system of record on the LAN; floor works with internet down | Workers/D1 are internet-only; the doc's quality goal #1 requires LAN-local writes. The phone outbox partly covers it (packs queue), but labels cannot print and dispatch cannot complete offline without a local core | ADR-001, Q-01, §8.5 |
| Postgres logical replication box ↔ cloud, forced RLS, PgBouncer, pgvector | D1 is SQLite: no RLS, no logical replication, no pgvector (Vectorize would be the CF analogue) | ADR-002, ADR-009, §5.3 |
| Mosquitto broker, MQTT topics, QoS 1 bridge | No MQTT broker in Workers (could be emulated with Durable Objects/Queues, but not on the LAN) | §8.4 |
| PLC collector at 1 Hz on an isolated PLC segment | Requires a device on the PLC network | ADR-006, OI-01, OI-05 |
| Timescale telemetry (1.7M rows/day, 90 days) + Grafana wall | D1 size/write limits make raw 1 Hz storage impractical **(inferred)**; Grafana needs a host | §6.1 |
| Aggregator (billet detection from ram stroke) | Needs the raw stream; could run on a Pi/box | §6.1 |
| Offline LAN label printing via a durable print agent | The printer is on the LAN; needs an agent on the packing Pi (the existing spool/edge-runtime is the nearest relative) | ADR-007 |
| Spectro folder watcher | Runs on the spectro PC; can POST to the cloud when online, but not offline-first | §7.1 |
| RS-232 scale → phone | Phone-side hardware integration (USB-serial / BT adapter) — works on any backend, but is native app work | §3.2 |
| Split DNS / one host name inside and out | Needs a LAN server answering for fourcubes.orrn.in | ADR-014 |
| GST egress from a static Indian IP | Workers egress IPs are not static Indian IPs; needs the Indian VPS (or an ASP/GSP that proxies) | ADR-008, OI-03 |
| Nightly pg_dump → age → R2, restore drill to a spare box | Only meaningful with a box | Q-02 |

Can be modelled now on the current stack (cloud-first, telemetry-ready):

| Capability | How **(inferred)** | Doc ref |
|---|---|---|
| Append-only kg ledger with voucher type/no/line, location, kg delta, posting time + tiebreak, is_cancelled, reversal sets; one D1 batch per write (document + ledger + audit) | D1 `batch()` is transactional | ADR-003 |
| DN submit = stock out with dispatch timestamp | Dispatch `complete` already stamps `completedAt` and flips bundles to dispatched; add ledger rows | ADR-004 |
| Bundle numbering 26I4086 with per-tenant series counters (doc type, prefix, FY) | Extend `company_sequence` to a keyed series table | §8.1, §8.8 |
| Legacy cuid map and QR resolver; typed old-style numbers | `parseScan` already accepts `/b/{serial}`; add cuid + regex handling | §8.3 |
| Location master (yard 1–6, billet store, scrap store), Move and Count screens, count checkpoints, phantom report | Pure CRUD + ledger | §8.6, §8.7 |
| Section catalogue vs die instance (oblique code, tier rank, dated), die weight readings, nitriding log, die card, drift report | Pure data | §8.1 |
| Purchase lots, vendors (aliases), D/C notes, scrap items/grades, return streams | Pure data | §8.1 |
| Cast (with campaign/melt if ADR-013 accepted), cast inputs, spectro attachment by file upload (R2) instead of watcher | Upload endpoint in place of watcher; watcher later posts to same endpoint | §8.1, OI-02 |
| Press run with manual entry of every field the aggregator would fill (billet rows, pressure, speed, temps, cycle s, dead s) plus `source` = manual / telemetry and `is_historical` | Telemetry-ready fields; aggregator later writes the same rows | §6.1, R-01 |
| Telemetry import endpoint (shift rollups, billet events posted in batches by an edge device) | Accept the `fc/shift/rollup` / billet payloads over HTTPS | §8.4 |
| Cut, QC, Ageing screens | Pure data | §8.6 |
| Sales orders with baki, finish, status Confirm/Dispatch/Booking | Pure data; outbox semantics trivial while there is one writer (cloud) | §8.1 |
| Idempotent mutation envelope (`clientMutationId`) for the native app outbox | `mutation` table already exists with a unique (company, device, clientMutationId) index; no router uses it yet | §8.4, ADR-010 |
| Station pairing by QR + PIN login + 8 h lock | better-auth extension / custom session; device table exists (per-user) | ADR-010 |
| Print job id idempotency + acks | Spool integration already has jobs and `print_log`; add job-id uniqueness and ack state | ADR-007 |
| Reports §8.7 as JSON + xlsx; 7 am WhatsApp via a Cron Trigger | Cron Triggers + a WhatsApp provider | §8.7 |
| Invoice drafting, PL ↔ Inv No link, Tally XML export, GSTR-1/3B JSON | Pure data/export; IRN/EWB calls via an egress service | §6.2 |
| AI resolver / extraction queue / reconciliation with review queues | Workers can call the Claude API | ADR-011 |
| Forced tenant isolation | No RLS in D1; keep `company_id` on every row + server-side scoping + a CI test equivalent to Q-07 | ADR-009 |

---

## 7. One dispatch, order to e-way bill (§6.2, ADR-004, ADR-008, ADR-012, OI-07, OI-10)

Top lane runs on the plant box; bottom lane in the cloud; crossings are the only places a truck can be made to wait on the internet, each with a fallback (§6.2). §6.2 is drawn with orrn taking over invoicing (OI-07 open).

### 7.1 Plant lane (in order)

| # | Step | Detail |
|---|---|---|
| 1 | Sales Order | office; finish AND, PVD, 6061; line die, kg/12ft, pcs, baki; outbox-synced both ways |
| 2 | Dispatch | yard scan, die by die; bundles reserved; old cuid QR accepted |
| 3 | Packing List | snapshot with header; PO no · Inv no linked; 11 columns, range/12' |
| 4 | Delivery Note | internal, not printed; **submit = stock out**; sets dispatch timestamp |
| 5 | Tax Invoice | takes over from Tally; GST lines, HSN, POS; **proforma if offline** |
| 6 | Final invoice print | signed QR on the page; signed JSON stored; 3 copies + EWB pages |
| 7 | EWB Part-B | vehicle no at the gate; valid_upto from reply; ≈ 1 day per 200 km |

### 7.2 Cloud lane

| # | Step | Detail |
|---|---|---|
| A | IRN request | IRIS IRP, INV-01 JSON; 30-day cap if AATO ≥ ₹10 Cr; cancel ≤ 24 h and only pre-EWB |
| B | EWB Part-A by IRN | through the ASP; ship-to GSTIN on hold (GSTN advisory 668) |
| C | EWB update | Part-B, extend ± 8 h, cancel ≤ 24 h; closure API on hold |
| D | Month end | GSTR-1 and 3B JSON built from the ledger; Tally XML for the CA; filing needs an OTP so it stays a person's click in the panel |

Crossings: Tax Invoice → "report invoice" → IRN request; IRN + signed QR → Final invoice print; vehicle no → EWB update (Part-B).

### 7.3 Rules

- Truck carries the PL with bundle detail + the tax invoice in three copies, each followed by its e-way bill page; no challan exists; the DN is internal (§6.2).
- No internet at invoicing: proforma goes with the truck; final invoice prints when the IRN returns. No EWB API: bulk JSON uploaded on the portal from any phone (§6.2, §8.5).
- IRN cancellation only within 24 h and only while no EWB is active, so a wrong invoice is in practice fixed by a credit note or a GSTR-1 amendment (Fig 6-2).
- EWB validity stored as `valid_upto`; extension window ± 8 h (§5.3).
- Retry worker every 5 min; status in e_invoice_log / e_waybill_log `Pending → Auto-Retry → …` (§8.1, §5.3) — remaining states **(not specified)**.
- Dispatch register shows EWB status and expiry (§8.7); GST report alerts daily on unreported invoices nearing 30 days (§8.7).
- Invoice series per FY, never reused; line → DN line (§8.1).
- OI-10: when GSTN lifts the hold, the Sales Order carries a ship-to GSTIN and the gate adds an EWB closure call on delivery day or the next.
- Q-08 / M7: invoice and EWB the same day the truck leaves.

### 7.4 Tally vs orrn invoice (OI-07, ADR-012, ADR-008)

| Option | What happens | Consequences |
|---|---|---|
| A. Tally stays invoice of record (today) | §6.2 collapses to a **PL → Inv No link**: orrn records the Tally invoice number on the PL; Tally on the ops PC keeps issuing invoice, IRN and EWB | IRP and ASP adapters are dropped; ADR-008 withdrawn; GST egress VPS not needed; Tally "runs beside orrn" debt remains (§11.3) |
| B. orrn becomes invoice of record (proposed, ADR-012) | orrn issues tax invoice, IRN (IRIS IRP) and EWB (NIC via ASP); Tally gets a monthly XML export for the CA | Needs ADR-008 (Indian VPS static IP), OI-03 (IRIS registration, ASP cost), Phase 6 |

Deciders: owner and CA (OI-07). Needed by Phase 6. Phase 6 done when one month is invoiced from orrn and reconciled by the CA (§A.4).
Either way: PL and invoice must be linked (§O.3 accountant row: "PL and invoice linked, GST file ready, Tally export monthly").

---

## 8. Architecture decisions ADR-001 … ADR-015 (§9)

| ADR | Decision | Status (since) | Implication for the build |
|---|---|---|---|
| ADR-001 | The plant box is the system of record | Accepted (C) | Core must run on a LAN mini PC; cloud is replica. Needs UPS, spare, nightly backup, install visit per plant (Q-01, Q-02) |
| ADR-002 | One writer per table | Accepted (C) | Every table tagged plant / cloud / outbox; owner checked in CI; any two-writer feature needs a new ADR. Sales orders use an outbox with idempotency keys |
| ADR-003 | Append-only kg ledger, one transaction per write | Accepted (C) | Document + ledger delta + audit in one txn; ledger rows never updated or deleted; corrections are void + reversal (two rows). Stock on any date rebuildable |
| ADR-004 | Submitting the delivery note takes stock out | Accepted (C) | No move-to-sold step; DN submit moves kg out and stamps time; gate scans every bundle; a bundle on one PL cannot be scanned onto another |
| ADR-005 | The QR carries only the bundle number | Accepted (C) | QR = `/b/{bundle no}`; lookups need box or cloud; old cuid QR accepted until old stock sold |
| ADR-006 | Read-only PLC tap on its own segment | Accepted (C) | Collector on cabin Pi, 1 Hz, isolated network, disk buffer; nothing written to the press; protocol depends on OI-01 |
| ADR-007 | Durable print agent, job id as the idempotency key | Accepted (C) | Go agent with SQLite outbox, prints once per job id, parks when not ready, repeats ack until confirmed; printer reachable only from agent |
| ADR-008 | GST calls leave from an Indian VPS with a static IP | Proposed (C) | Build IRP (IRIS) + ASP adapters on an Indian VPS with retry every 5 min and logs — only if OI-07 picks orrn and OI-03 settles registration/cost |
| ADR-009 | Multi-tenant cloud with forced row-level security | Accepted (C) | RLS enable + force on every tenant table; app role owns nothing; tenant from Host header set per txn; CI fails tables without forced RLS; PgBouncer/partitioning wait for OI-04 |
| ADR-010 | Phones pair to a station, people sign in with a PIN | Accepted (C) | Station pairing QR, PIN login, local SQLite outbox, idempotent mutations; OI-06 may change sign-in/pairing only |
| ADR-011 | AI stays out of the floor loop | Accepted (C) | AI runs on cloud replica via tool calls with the user's own token; outputs go to review queues; a person approves every extraction |
| ADR-012 | Invoice of record moves from Tally to orrn | Proposed (D) | §6.2 drawn this way; if Tally kept, §6.2 becomes a PL → invoice number link and ADR-008 is withdrawn |
| ADR-013 | A cast is a campaign, not one melt | Proposed (D) | Model cast as a campaign with melts under it; keep plant cast numbers; must be settled before Phase 1 fixes the schema (press run and bundle hang off cast) |
| ADR-014 | One host name on the LAN and the internet | Accepted (C) | Split DNS to the box; real cert via DNS challenge; renewal every 60 days needs internet once, fails safe; router must allow DNS overrides |
| ADR-015 | No inbound ports; remote access through tunnels | Accepted (C) | Router forwards nothing; engineers via Tailscale; browsers via Cloudflare tunnel; replication rides Tailscale; LAN works without either |

Three are proposed (008, 012, 013); twelve accepted. Accepted ADRs are never edited; changes come as a superseding ADR (§0.4).

---

## 9. Open issues OI-01 … OI-11 (§11.1)

| OI | Issue | Scope | Who decides | Blocks (sections/ADRs) | Needed by | Status |
|---|---|---|---|---|---|---|
| OI-01 | Press PLC make, model, protocol. S7 via gos7 needs a TIA Portal change on the OEM CPU (enable PUT/GET, non-optimized DBs, re-download, DB values reset). OPC UA on S7-1500 needs server enabled + runtime licence. Only Modbus TCP needs no OEM visit | Fourcubes | Plant, press supplier | §5.2, §6.1, ADR-006 | Phase 5 | Open |
| OI-02 | Spectrometer export: does the spectro PC write a results file? If not, spectro attachment is a photo via AI extraction | Fourcubes | Foundry | §8.6 | Phase 4 | Open |
| OI-03 | IRIS IRP integrator registration: sandbox and production onboarding fix where the GST egress VPS lives and the ASP cost per EWB | Platform | orrn | §5.3, ADR-008 | Phase 6 | Open |
| OI-04 | Second tenant: with one plant, cloud Postgres still worth building, PgBouncer and partitioning can wait | Platform | orrn | §5.3, ADR-009 | Phase 8 | Open |
| OI-05 | Press cabin Ethernet: a free PLC port decides whether the collector stays on the cabin Pi or moves onto the box | Fourcubes | Plant | §5.2, §A.3 | Phase 7 | Open |
| OI-06 | Where phones live: shared station phones or personal; changes PIN login and pairing, not architecture | Fourcubes | Owner | §8.6, ADR-010 | Phase 2 | Open |
| OI-07 | Invoice of record: Tally keeps it (PL → Inv No link, IRP/ASP adapters go) or orrn takes it (Tally XML-only for CA) | Fourcubes | Owner and CA | §6.2, ADR-012, ADR-008 | Phase 6 | Open |
| OI-08 | What a cast is: letter = month, number = sequence, year not encoded. K31 covers 35 days and 60 t, so a campaign not a heat. Decide melt vs campaign before it becomes the spine of Press Run and Bundle | Platform | Owner, orrn | §8.1, §A.2, ADR-013 | Phase 1 | Open |
| OI-09 | Finishing: orders carry AND / PVD / 6061 but no anodise/PVD station. In-house line, job-work out (job-work challan + return step before packing), or a note on the label? Changes §A.2 and the SO line | Fourcubes | Owner | §A.2, §8.1 | Phase 4 | Open |
| OI-10 | GSTN un-holding ship-to: advisory 668 (29 Jul 2026) put mandatory Ship-to GSTIN and the EWB Closure API on hold. When it returns, SO carries ship-to GSTIN and the gate adds a closure call on delivery day or next | Platform | GSTN (outside) | §6.2 | When GSTN lifts the hold | Watching |
| OI-11 | Plant admin: who adds users, resets PINs, gets the call when the box is down; §O.5 suggests Dinesh | Fourcubes | Owner | §8.2 | Phase 2 | Open |

Owner decisions list (§O.5): OI-07 (Tally vs orrn invoice, ask the CA), OI-08 (what is a cast), OI-09 (anodise and PVD: where, by whom, does material leave the plant), OI-06 (phones per station or person), OI-11 (plant admin).

### 9.1 Risks (§11.2)

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-01 | PLC readable only after supplier visit/licence | Med | Med | Telemetry is phase 7 of 8; press sheet manual until then; prefer Modbus TCP |
| R-02 | Plant box is a single machine | Low | High | UPS, nightly encrypted backup, spare box, restore drill; phones hold outbox |
| R-03 | GST rules change during invoicing build | Med | Med | Adapters isolated on egress worker behind logs; watch advisories |
| R-04 | Floor staff drift back to paper | Med | High | Same forms, Gujarati, one big button; weekly reprint/refusal review for 3 months |
| R-05 | Legacy data problems move in: 62 % phantom, 69 names for ~40 customers | High | Med | Full count on cutover day; masters de-duplicated at import; AI resolver for names |
| R-06 | A feature writes one table from both sides | Low | High | Write owner per table checked in CI; shared rows only via outbox |
| R-07 | One engineer builds and runs orrn | Med | High | This document, ADRs, written restore drill |
| R-08 | Wi-Fi gaps in the yard | Med | Low | Phone outbox; 3 APs; a walk with a phone before Phase 2 |

### 9.2 Technical debt (§11.3)

| Debt | Why now | Retire when |
|---|---|---|
| Scanner accepts old QR as well as new | old labels still in the yard | last old-label bundle sold |
| fcms_db online, read-only, over Tailscale | history and audits still point at it | old stock sold through and history checked in orrn |
| Tally runs beside orrn for invoices | CA's books; ADR-012 proposed | ADR-012 accepted or withdrawn |
| No PgBouncer, no partitioning in cloud | one plant | second tenant signs (OI-04) |
| Printer status bytes re-derived from TSC manual | no test printer on the bench | verified on the packing printer in Phase 2 |

---

## 10. Rollout phases and plant profile

### 10.1 Plant profile (§A.1)

| Item | Value |
|---|---|
| Company | Fourcubes LLP, near Surat |
| Tenant host | fourcubes.orrn.in |
| Press | One |
| Volume | ~150 t and ~3,500 bundles a month |
| Stations | Scrap yard, foundry, press and die room, QC and ageing, packing, yard, gate |
| Orders also carry | Anodise, PVD and 6061, with no finishing station yet (OI-09) |
| Legacy system | FCMS on fcms_db; read-only after import; old labels scan until stock sold |
| Invoice today | Tally on the ops PC (ADR-012) |
| Plant admin | To be named (OI-11) |
| Baselines | §O.4 |

Hardware (§O.5, §7.1): mini PC + UPS (~₹70k–90k); 2 Raspberry Pis (~₹20k together, press cabin and packing); 7 mid-range Android phones (~₹15k each); 3 Wi-Fi APs (press, packing, yard) + a cable from PLC cabinet to cabin board; existing TSC label printer, ops PC and USB QR gun; RS-232 scale cable. Monthly: Indian server for GST (~₹2,000) + a few paise per EWB.
People (§O.5): storekeeper owns the store screen; a supervisor closes casts; Dinesh in the office as first plant admin; half a day of training per station in Gujarati on the real floor, on the real phone.
Time (§O.5): roughly six months of build; packing and dispatch first in about two months.

### 10.2 Floor walk summary (§A.2)

| Station | Physically there | App screen | Record | Ledger |
|---|---|---|---|---|
| Scrap yard | party vs FC kanta; challan + slip photos; grade A+…C, quality; WB = w-bill book, UB = part in w-bill; ~25 vendors, origin | Purchase | Purchase Receipt (vendor → resolved id; lot grade, quality; origin EC · 6063; party vs FC kg → D/C note, dross %; BOOKING → UNLOAD → OK) | + scrap lot by grade; daily draws → furnace |
| Foundry | furnace, LDO inches; chem open/used/close; spectro PC → watcher; 9 return streams in; dross, Fe, burn loss; 5 timestamps a melt | Cast | Cast ((year, month, seq) shown as K31; scrap + returns kg; logs pcs · mm · kg; spectro CSV; alloy 6063/6061) | − scrap, − returns; + logs, dross, Fe |
| Billet store | logs tagged by cast; scan on the move; cast = campaign? open | Move | Stock move cast → billet store, timestamped, by whom | location move |
| Press | PLC read-only 1 Hz; collector → MQTT; Grafana on wall; die in/out on phone; downtime reason on phone; log heater, die oven | Press Run | Press Run (shift): cast, die (oblique), tier, per-billet rows, kg/12ft now vs last, downtime + reason, footer discard + ends, op + supervisor sign | − billets, + discard; ends + rejects return |
| Stretch and cut | cut length in inches; pieces counted; section ends weighed | Press Run line | cut length, pieces, recovery % computed, ends kg → plant scrap | + section-ends kg → Plant Scrap |
| QC | wastage kg; remark → reason code; dated list today | QC | QC entry: reject kg, reason; linked to cast + die | − reject kg → Plant Scrap |
| Ageing oven | gas meter start/end; temperature, shift; in/out/total time; hardness per row | Ageing Batch | gas used, temp, time; hardness per row; PO carried | none (process record) |
| Packing | scale RS-232 → phone; TSC :9100; print agent on Pi; QR = bundle no; weight sanity vs die | Pack | Bundle: kg, pcs, length; die + cast + location; kg/12ft; range 0.1 floor; order line suggested; label job queued | + bundle kg at location |
| Stock yard | loc 1–6, no default; scan to move; quarterly count; old labels cuid QR | Move · Count | presence checkpoint "seen at location 3"; feeds phantom report; scans no or old cuid; cast close-out: tails | move · checkpoint; balance restarts |
| Dispatch gate | scan bundles onto a PL; vehicle no (Part-B); PL + invoice printed; driver ID photo | Dispatch | Dispatch → PL snapshot with header; PO no · Inv no linked; DN submit internal; dispatch timestamp set; EWB Part-B vehicle no | − bundle kg, sold, timestamped |

Beside the line: Central store (MRS issue, GRN receipt, old-for-new spares; feeds foundry chemicals, LDO, nitriding, gas; Hindi SOP by Lalubhai; app Store). Die room (supplier → tool room → nitriding → die oven → press → back; Die Card; Nitriding Sheet; die instance = oblique code permanent, tier mutable; apps Die Card, Nitriding). Legacy coexistence (~2,500 cuid-label bundles, 500 J540-style; resolver accepts bundle no or cuid; fcms_db read-only; Stock Count tool retires into Count screen). Order book (line: die, kg/12ft, length, pcs, cast, BAKI; status Confirm/Dispatch/Booking; ~40 customers after dedupe; finish AND/PVD; app Orders).

Fig A-1: press, packing and gate are where the old system lost data (no die on the bundle, entered-not-weighed bundles, dispatch marked after the truck left); die room is the only place tier is re-ranked.

### 10.3 Rollout phases (§A.4) — the document's build order

Weeks are effort, not calendar. Each phase ends with something the floor uses.

| Phase | Weeks | Delivers | Done when |
|---|---|---|---|
| 0 · Facts | 1 | PLC model and protocol, spectro export, IRIS registration, static IP VPS, label size, phone plan | the open issues in §11.1 have answers |
| 1 · Core | 3 | Postgres schema: bundle, ledger, docstatus, series, RLS, audit trigger; permissions ported; masters loaded and deduped | a bundle can be created, moved and dispatched from a test client and the ledger balances |
| 2 · Box and app | 4 | plant box installed; Pack, Move, Count, Dispatch screens; print agent on packing Pi; PL with a header | one full day packed and dispatched with no Excel |
| 3 · Cutover | 1 | legacy import (2,493 live bundles, 83k sold as history), old QR accepted, fcms_db read-only, count on cutover day | stock by location equals the count; old labels scan |
| 4 · Purchase, foundry, orders | 4 | Purchase, Cast, Store, Orders, order balance, D/C notes | the purchase book and ORDER FILE are closed |
| 5 · Press and dies | 3 | Press Run, Cut, QC, Ageing, Die Card, Nitriding, tier re-rank | the paper press sheet stops |
| 6 · Invoicing | 3 | tax invoice with GST lines, IRIS sandbox then production, EWB via ASP, Tally export, proforma offline | one month invoiced from orrn and reconciled by the CA |
| 7 · Telemetry | 3 | cabin Pi collector, Mosquitto, telemetry store, aggregator, Grafana, auto-filled press sheet | billets per shift match the operator's count within 2 % |
| 8 · Cloud and AI | 4 | replication, fourcubes.orrn.in from outside, reports, resolver, extraction queue, reconciliation | the manager reads the 7 am report from home |

Total effort: 26 weeks (≈ six months, §O.5).

Gate dependencies from OIs: OI-08 → Phase 1; OI-06, OI-11 → Phase 2; OI-02, OI-09 → Phase 4; OI-01 → Phase 5; OI-03, OI-07 → Phase 6; OI-05 → Phase 7; OI-04 → Phase 8.

Cutover day, in order (§A.4):
1. Freeze the legacy system after the last dispatch.
2. Run the count with the old tool.
3. Import into the box.
4. Reconcile stock by location against the count; explain every difference before anyone packs.
5. Switch the label printer to the new template.
6. First bundle of the new day is packed on the app.
7. Old system stays readable, never writable.

---

## 11. Glossary (§12, plus plant terms used elsewhere)

| Term | Meaning | Source |
|---|---|---|
| Bundle | Tied set of profiles of one section, die and cast, weighed and labelled at packing; the unit of stock | §12 |
| Bundle number | Plant's number for a bundle, e.g. 26I4086; the only thing in the QR | §12, ADR-005 |
| Cast | Billets from the foundry under one number: month letter + sequence, e.g. K31 | §12, ADR-013 |
| Campaign vs melt (heat) | Proposed: a cast is a campaign (K31 ran 35 days, 60 t) with melts under it | ADR-013, OI-08 |
| Log / billet | Logs are cast output (pcs · mm · kg); a billet is one piece pressed per ram stroke **(inferred: billets cut from logs)**; "billet = one ram stroke" | §A.2, §6.1 |
| Section | Profile design in the catalogue, with drawing, HSN, thickness (code e.g. 12170, series e.g. Domal) | §12, §8.1 |
| Die, oblique code | Physical die for a section; the oblique code (12170-1) tells copies of the same section apart on the floor | §12 |
| Tier | A die's weight rank among copies of its section; re-ranked in die room; not printed on label | §12 |
| kg/12 ft, weight range | Weight of 12 ft of profile, the trade number. Range = floor((kg/12ft + 0.01) × 10) / 10, the number the customer is billed on | §12, Fig A-1 |
| Kanta: party and FC | Vendor's weighbridge figure and the plant's own weight for the same scrap lot | §12 |
| WB, UB | WB = w-bill, a separate bill book holding less information. UB = under-billed, a lot part of which went to the w-bill | §12 |
| D/C note | Debit or credit note on a scrap lot when weight or grade differs | §12 |
| Bori deduction | Deduction on a D/C note, bags **(inferred)** | §8.1 |
| Dalal (broker) | Brokers are not modelled; "K in name = broker, not kept" in vendor names. ("dalal" itself is not used in the document) | §1.1, §8.1 |
| Baki | Order balance: kg and pcs still to dispatch on each order line | §12 |
| PL | Packing list: the bundles on one truck, built by scanning at the gate | §12 |
| Delivery note | The document whose submit takes stock out | §12, ADR-004 |
| IRN, IRP | Invoice Reference Number with signed QR from an Invoice Registration Portal; orrn uses IRIS | §12 |
| EWB, ASP | E-way bill from NIC, reached through an application service provider; Part-A (by IRN) and Part-B (vehicle) | §12, §6.2 |
| Proforma | Invoice printed while offline; final invoice prints when the IRN returns | §6.2 |
| AATO | Aggregate annual turnover (≥ ₹10 Cr → 30-day reporting cap) **(expansion inferred)** | §5.3 |
| MRS, GRN | Store issue slip and goods receipt note | §12 |
| Old-for-new | Spares exchange in the store | §8.1 |
| LDO | Light diesel oil for the furnace, read in inches on the tank | §12 |
| Dross, burn loss | Oxide skimmed off the melt; metal lost in melting | §12 |
| Fe | Iron recovered as by-product at the foundry **(inferred)** | §A.2 |
| Return streams | ingot, plant scrap, discard, dross ingot, bend log, hill metal, pit, tendis, dross metal | §8.1 |
| Discard / ends | Discard: butt-end metal from the press **(inferred)**; ends: section ends after cutting, weighed, to Plant Scrap | §A.2 |
| Recovery | Good kg out as a share of kg in | §12 |
| FTR | Die card field **(meaning not specified)** | §8.6 |
| CR4, CR2, K2S, caustic soda | Nitriding chemicals tracked open/used/close | §8.1 |
| AND / PVD / 6061 | Order finish/attribute: anodise, PVD coating, alloy 6061 | §6.2, OI-09 |
| Phantom bundle | Bundle the system holds that is not in the yard at a count | §12 |
| Plant box | Mini PC in the plant office that runs orrn for that plant | §12 |
| Tenant | One plant's company in the cloud at its own host name | §12 |
| Ledger | Append-only list of kg movements | §12 |
| Outbox | Local queue holding writes until the other side confirms | §12 |
| Idempotency key | Id that makes a repeated request do nothing the second time | §12 |
| RLS | Postgres row-level security | §12 |
| ADR, OI | Architecture decision record; open issue | §12 |
| docstatus | Document status on plant documents **(values not specified)** | §5.2, §8.1 |
| Station | A floor work point with a paired phone (scrap yard, foundry, press + die room, QC + ageing, packing, yard, gate) | §A.1, ADR-010 |
| cuid | 25-char legacy id in old QR labels | §8.3 |
| Kg tolerance (customer) | Customer-specific kg tolerance on the customer master | §8.1 |

Terms the request mentioned that the document does not use: "multilog heater" (doc: "log heater"), "dalal" (doc: "broker"), "7 am report" (used, §O.2/§8.7), "die report" (used only in §O.2 month-end).


---

## 12. Gap table: document vs current repo

Repo snapshot read on 2026-10-03: D1/SQLite schema in `packages/db/src/schema/` (`audit.ts`, `auth.ts`, `catalog.ts`, `customers.ts`, `dispatch.ts`, `inventory.ts`, `packing.ts`, `printing.ts`, `spool.ts`, `sync.ts`, `tenant.ts`) and tRPC routers in `packages/server/src/routers/` (`auth`, `bundle`, `company`, `customer`, `dashboard`, `die`, `dispatch`, `edge`, `invite`, `packingList`, `spool`, `waitlist`, `platform/{companies,impersonation,staff,waitlist,spool}`).

Legend: **EXISTS** = covers the document's intent for that module; **PARTIAL** = something is there but key fields, rules or semantics differ; **MISSING** = nothing in the repo.

### 12.1 Summary by module

| # | Module (doc ref) | Status | Existing tables | Existing routers / procedures | Main gaps vs the document |
|---|---|---|---|---|---|
| 1 | Tenant (§8.1 Platform, ADR-009) | PARTIAL | `company` (slug, status, settings, plan, modules, spoolBaseUrl) | `platform.companies*`, `company.updateSettings` | No GSTINs, e-invoice-applicable flag, host name field (slug may serve), plant boxes list. No RLS (D1); isolation is server-side `company_id` scoping |
| 2 | Users, roles, PIN (§8.1, §8.2, ADR-010) | PARTIAL | `user` (better-auth), `membership` (role enum owner/admin/manager/operator/viewer), `invite`, `platform_admin`, `impersonation_grant` | `auth.me/setPassword/changeInitialPassword/completeOnboarding`, `company.members*`, `invite.*` | 5 generic roles vs 12 doc roles; no PIN login; `membership_user_unique` on `user_id` means one tenant per person, the doc needs many tenants per person (accountant); email/password only |
| 3 | Permissions matrix (§8.2) | PARTIAL | — | `packages/server/src/lib/permissions.ts` (ACTIONS: customer.*, die.*, receipt.*, bundle.*, dispatch.*, packingList.regenerate, member.*, settings.update, edge.manage, spool.*, platform.*) | Shared server/client action list exists (matches the doc's `permissions.ts` idea). Missing actions for void-with-reason, count, cast, press, die weight, nitriding, tier re-rank, purchase, D/C note, store, SO, invoice/IRN/EWB, IRN cancel, masters draft, GST/Tally export, reports. No "approve" semantics |
| 4 | Audit log (§8.1, §8.2) | PARTIAL | `audit_log` (actor, impersonator, action, subject, meta json, at) | written by routers | Not a DB trigger; no device, no before/after columns (could live in meta), no txn id. Impersonator already captured |
| 5 | Device + station pairing (§8.1, §A.3, ADR-010) | PARTIAL | `device` (per user: platform, appVersion, installId, pushToken, lastSeen) | — | Devices are tied to a user, not a station; no pairing QR, one-time token, device key, station, revoke; no Pi/printer/PLC device kinds |
| 6 | Mutation log / outbox (§8.1, §8.4) | PARTIAL | `mutation` (companyId, deviceId, clientMutationId unique, entity, op, payload, result applied/duplicate/conflict/rejected) | none found referencing it | Table exists; no `POST /mutations` envelope router uses it yet |
| 7 | Series counter (§5.2, §8.1) | PARTIAL | `company_sequence` (one integer per company) | `lib/sequence.ts nextCompanySeq` (atomic upsert-returning) | Single counter per company; doc needs (tenant, doc type, prefix, FY) series. Also used as `serverSeq` sync cursor |
| 8 | Section catalogue (§8.1 Section) | PARTIAL | `die` (series, sectionCode, name, obliqueMm, legMm, widthMm, thicknessMm, dimensions, weightMinG, weightMaxG, status active/archived) | `die.list/get/create/update/delete/validateImport/processImport` | Current `die` is really a section+weight-band row (unique on series+sectionCode). No HSN, drawing, design kg/12ft, tier bands. Note `obliqueMm` is a dimension, not the doc's oblique code |
| 9 | Die instance, oblique code, tier (§8.1, §12) | MISSING | — | — | No physical die copy entity: oblique code 12170-1, tier rank (dated), supplier, trial kg, hardness, life, FTR, status in/out/retired |
| 10 | Die weight reading, drift (§8.1, §8.7) | MISSING | — | — | No readings, no tier suggestion, no drift report |
| 11 | Nitriding log, die card (§8.1, §8.6) | MISSING | — | — | |
| 12 | Machine (§8.1) | MISSING | — | — | |
| 13 | Bundle (§8.1, §8.3) | PARTIAL | `bundle` (groupId, dieId, serial, poNumber, quantity, weightG, lengthMm, status available/reserved/dispatched/void, currentDispatchId, createdBy/At), `bundle_status_event` (from/to, reason, actor, dispatchId) | `bundle.getBundle/getBySerial/listBundles/transitionStatus/stockSummary/bulkImport` | Serial format is `BG-000123-B001` (`lib/bundleSerial.ts`), not 26I4086; no cast, no die instance (die = section), no location, no legacy cuid, no stored kg/12ft or range, no order line. Void exists via status with reason in status event |
| 14 | Packing session / "receipt" (bundle_group) | EXISTS (repo-only concept) | `bundle_group` (code BG-xxxxxx, dieId, unit, purchaseOrderRef) | `bundle.createReceipt/listGroups/getGroup` | Not in the document. Note the naming clash: the doc's "Purchase receipt" means scrap intake (§8.2), whereas repo "receipt" = a packing batch of bundles. Rename before adding scrap purchase **(inferred recommendation)** |
| 15 | Pack screen rules (§8.6 Pack) | PARTIAL | — | `bundle.createReceipt` | `domain/units.ts` already has `kgPer12ft` and `weightRange12ft` (= floor((kg/12ft + 0.01) × 10) / 10). Missing: weight from scale, band check with nearest-oblique warning, mandatory location, no-edit-after-label rule |
| 16 | Stock ledger (§8.1, ADR-003) | MISSING | — | `bundle.stockSummary` computes from bundle status | No append-only kg ledger; stock is bundle status. No voucher type/no/line, posting time, reversal sets |
| 17 | Location (§8.1) | MISSING | — | — | No yard 1–6 / billet store / scrap store |
| 18 | Move (§8.6) | MISSING | — | — | |
| 19 | Count checkpoint + phantom check (§8.1, §8.7) | MISSING | — | — | Stock count is a separate offline tool on the ops PC today (§A.2) |
| 20 | Print job / log, label template, printer (§8.1, ADR-007) | PARTIAL | `label_template` (versioned, schema, variables, spoolTemplateId), `printer_profile` (spoolPrinterId, templateId, defaultCopies), `print_log` (status queued/sent/success/failed, spoolJobId, variables, payloadHash, attempt) | `spool.listPrinters/getPrinterStatus/listTemplates/listProfiles/listJobs/getJobStatus/deploymentStatus` | Prints through the external spool; no job-id idempotency key with UNIQUE on both ends, no ack replay, no MQTT. Label template is tenant-scoped (doc: cloud-owned, versioned TSPL2 with QR contract). Reprint reason not recorded |
| 21 | Edge node / plant box registration (§5.1, §7.1, fleet) | PARTIAL | `spool_deployment` = `edgeNodeDeployment` (instanceId, nodeName, siteLabel, subdomain, nodeDomain, cfTunnelId, wrapped tunnel token, shared secret, runtimeFlavor/Platform, capabilities, heartbeat, lastSyncCursor) | `edge.overview/enroll/revoke`, `packages/edge-runtime` | Closest thing to the plant box / Pi registry with Cloudflare tunnel. Not a system-of-record core; no Tailscale, no replication, no MQTT |
| 22 | QR resolver (§8.3, §8.4) | PARTIAL | — | `domain/serial.ts parseScan` (bare serial or URL ending `/b/{serial}`), `bundle.getBySerial` | Missing legacy cuid map; regex for `^\d{2}[A-L]\d{1,5}$` and `^[A-L]\d{1,5}$` with year prompt; public `/b/{no}` page — `apps/web/src/routes/_public/` has only index, invite, login, waitlist, so there is no QR landing page yet |
| 23 | Customer, ship-to (§8.1) | PARTIAL | `customer` (name, phone, email, billingAddress json, shippingAddress json, taxId) | `customer.list/get/create/update/delete/importCsv` | No aliases, single ship-to, no kg tolerance, no price list; dedupe of 69 → 40 names not modelled |
| 24 | Sales order, lines, baki, finish (§8.1, §8.7) | MISSING | — | — | `bundle.poNumber` and `bundle_group.purchaseOrderRef` hold a PO string only |
| 25 | Dispatch and item (§8.1, §8.6) | PARTIAL | `dispatch` (code, customerId, status draft/reserved/completed/cancelled, shipDate, completedBy/At), `dispatch_item` (bundleId, groupLabel) | `dispatch.create/list/get/update/addBundle/addBundlesBySerial/setItemGroupLabel/removeBundle/reserve/unreserve/complete/cancel/softDelete` | State machine matches the doc (draft → reserved → completed) plus cancelled. `complete` stamps `completedAt` and flips bundles to dispatched (this is ADR-004 in spirit, minus ledger rows). "Bundle not on another PL" already holds: `addBundle` only reserves `available` bundles and sets `currentDispatchId`, so a bundle on another dispatch is reported unavailable. Missing: vehicle, driver, driver photo, SO line on item |
| 26 | Packing list snapshot (§8.1, §6.2) | PARTIAL | `packing_list` (dispatchId unique, code, snapshot json), `packing_list_line` (bundle, die, qty, weightG, lengthMm, groupLabel) | `packingList.create/get/byDispatch/list/regenerate`; `packages/documents/src/packing-list/{html,xlsx,snapshot}.ts` | Snapshot header has customer, dispatch code, ship date, totals. Missing: PL no from the plant's book, vehicle, PO no, Inv no link, the 11-column layout with range/12' |
| 27 | Delivery note (§6.2, ADR-004) | PARTIAL | — | `dispatch.complete` | No separate DN document; dispatch completion plays the role without a ledger |
| 28 | Invoice and line (§8.1) | MISSING | — | — | |
| 29 | e-invoice / e-way bill logs, GST egress (§5.3, ADR-008) | MISSING | — | — | |
| 30 | Tally XML / GSTR-1 / 3B export (§6.2, §8.7) | MISSING | — | — | |
| 31 | Vendor (§8.1) | MISSING | — | — | |
| 32 | Purchase lot, kanta, bill book (§8.1, §8.6) | MISSING | — | — | |
| 33 | Debit / credit note (§8.1) | MISSING | — | — | |
| 34 | Scrap item and grade, return streams (§8.1) | MISSING | — | — | |
| 35 | Store item, MRS, GRN (§8.1, §8.6) | MISSING | — | — | |
| 36 | Cast (+ melts, spectro, close-out) (§8.1, ADR-013) | MISSING | — | — | |
| 37 | Press run and line, billet events, downtime (§8.1) | MISSING | — | — | |
| 38 | Cut (§8.6) | MISSING | — | — | |
| 39 | QC entry (§8.1) | MISSING | — | — | |
| 40 | Ageing batch (§8.1) | MISSING | — | — | |
| 41 | Telemetry samples, rollups, aggregator, Grafana (§6.1) | MISSING | — | — | Cannot run on Workers/D1; needs plant box or Pi (see §6.9) |
| 42 | Reports (§8.7) incl. 7 am WhatsApp | PARTIAL | — | `dashboard.today` | One dashboard query; none of the 12 §8.7 reports; no WhatsApp |
| 43 | Masters sync for phones (§8.4 `GET /sync/masters?since=`) | PARTIAL | `serverSeq` column on most tables; `spool_deployment.lastSyncCursor` | — | `serverSeq` is a delta-sync cursor already; no single `sync/masters?since=` endpoint found in the routers |
| 44 | AI resolver / extraction / reconciliation (§5.3, ADR-011) | MISSING | — | — | |
| 45 | Platform console, orrn staff impersonation (§8.2) | EXISTS | `platform_admin`, `impersonation_grant` (time-boxed, reason, revoke), `waitlist_request` | `platform.overview`, `platform.companies*`, `platform.impersonationRevokeGrant`, `platform.staff*`, `platform.waitlist*` | Matches "act as a tenant user (time-boxed, audited)" |
| 46 | Backup / restore drill (§5.2, Q-02) | MISSING | — | — | D1 has Time Travel; not the doc's box backup model |

### 12.2 Repo concepts with no counterpart in the document

- `bundle_group` / "receipt" (packing batch) — repo-only.
- `waitlist_request`, `invite` — onboarding flow; doc only says plant admin adds users.
- `company.plan`, `company.modules` — commercial packaging; not in doc.
- `company_sequence` doubling as `serverSeq` sync cursor.

### 12.3 Field-level gaps on the two tables that exist on both sides

Bundle (doc §8.1 vs `bundle`):

| Doc field | Repo column | Status |
|---|---|---|
| no 26I4086 | `serial` (BG-000123-B001) | PARTIAL — format differs |
| legacy cuid | — | MISSING |
| section | `die_id` → `die.section_code` | PARTIAL — die row = section |
| die instance | — | MISSING |
| cast | — | MISSING |
| kg | `weight_g` | EXISTS (grams) |
| pcs | `quantity` | EXISTS |
| length | `length_mm` | EXISTS (mm) |
| kg/12ft | computed in `domain/units.ts` | PARTIAL — not stored |
| range | computed in `domain/units.ts` | PARTIAL — not stored |
| location | — | MISSING |
| status | `status` available/reserved/dispatched/void | EXISTS (doc values not specified) |
| packed by / at | `created_by`, `created_at` | EXISTS |
| PO | `po_number` | EXISTS (string) |
| SO line | — | MISSING |

Dispatch (doc §8.1 vs `dispatch`):

| Doc field | Repo column | Status |
|---|---|---|
| customer | `customer_id` | EXISTS |
| vehicle | — | MISSING |
| driver (+ photo) | — | MISSING |
| item: bundle | `dispatch_item.bundle_id` | EXISTS |
| item: SO line | — | MISSING |
| status draft → reserved → completed | `status` + cancelled | EXISTS |
| dispatch timestamp (DN submit) | `completed_at` | EXISTS (semantics) |
| PL no (plant book) | `packing_list.code` | PARTIAL — generated, not the plant's book |
| PO no, Inv no on PL | — | MISSING |

### 12.4 Recommended build sequence mapped to the gap table (digest's reading of §A.4)

The document's order (§A.4) is Facts → Core → Box and app → Cutover → Purchase/foundry/orders → Press and dies → Invoicing → Telemetry → Cloud and AI. On the current Cloudflare stack the "box" and "telemetry" phases need infrastructure decisions; everything else maps onto missing modules as follows **(inferred mapping)**:

| Doc phase | Repo modules to build (gap # above) | Blocking OIs |
|---|---|---|
| 0 Facts | — (answer OIs) | OI-01…OI-11 |
| 1 Core | 7 series per doc type/FY; 9 die instance split from 8 section; 13 bundle fields (cast, die instance, location, cuid, number format); 16 ledger; 17 location; 36 cast skeleton (needed as FK); 3 permissions ported to doc roles; 2 multi-tenant membership; 4 audit before/after; 23 customer dedupe/aliases | OI-08 |
| 2 Box and app | 15 Pack rules; 18 Move; 19 Count; 25/26 dispatch + PL header (vehicle, PL no, PO/Inv link); 20 print idempotency + ack; 5 station pairing + PIN; 6 mutation envelope; 21 plant box decision | OI-06, OI-11 |
| 3 Cutover | 22 legacy cuid resolver; bulk import (exists: `bundle.bulkImport`, `die.processImport`) extended for 2,493 live + 83k history; count on cutover day | — |
| 4 Purchase, foundry, orders | 31–35 vendor, lots, D/C notes, scrap/return masters, store; 36 cast full + spectro upload; 24 sales orders + baki | OI-02, OI-09 |
| 5 Press and dies | 37–40 press run, cut, QC, ageing (manual, telemetry-ready); 10–12 weight readings, nitriding, die card, tier re-rank | OI-01 (for later telemetry) |
| 6 Invoicing | 27 DN; 28 invoice; 29 GST egress; 30 Tally/GSTR exports | OI-03, OI-07 |
| 7 Telemetry | 41 (plant-side infra) | OI-01, OI-05 |
| 8 Cloud and AI | 42 reports + 7 am WhatsApp; 44 AI; 46 backups | OI-04 |
