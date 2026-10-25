# The demo plant

`POST /dev/seed` builds one coherent plant, "Fourcubes Extrusions (Demo)", that every merged module reads
without contradicting another. It is the data behind the e2e suite, the screenshots and every demo. This
page says who logs in as what, what is in the plant, and what to show.

The seed is idempotent (run it again and you get the same rows, same ids) and time-robust (everything
that must read as "today" sits inside the current production day, 08:00 to 08:00 for the demo shifts,
whatever the hour you run it; a test seeds at seven different moments, across a month and a financial
year). It never writes a secret: the one shared password is `vars.ORRN_LOCAL_PASSWORD` in
`apps/server/wrangler.local.jsonc` (local only), and `/dev/seed` refuses to run off localhost.

```bash
source .wt-ports.env                              # in a worktree
bun run --cwd apps/server dev:local:migrate
bun run --cwd apps/server dev:local               # API on $E2E_API_PORT
bun run --cwd apps/web dev:bare                   # web on $E2E_WEB_PORT
curl -XPOST localhost:$E2E_API_PORT/dev/seed      # prints the counts below
bun run --cwd apps/server scripts/write-local-accounts.ts   # writes apps/server/.dev.local-account.local
```

Anything made in the UI on the demo company is discarded by the next seed. Existing logins are kept.

## Who logs in as what

One password for all (`ORRN_LOCAL_PASSWORD`). Emails are `{key}@orrn.local`. Every plant role has a login;
`staff` is ORRN platform staff (not a member) and `party` is a customer portal login (never a member).

| Login | Role | Show them |
| --- | --- | --- |
| `owner` | owner | Everything; decides every approval; the only one who sees all settings |
| `admin` | admin | Settings, members, devices, backups |
| `manager` | manager | Approvals queue (3 waiting), closes orders, decides reallocations and late entries |
| `office` | office | Orders and the press plan board, packing lists, portal grants (raised SO-1..SO-10) |
| `accountant` | accountant | Prices on orders, the scrap purchase book and D/C notes |
| `supervisor` | supervisor | Press station: log runs, close, queue, the stock count (CNT-1) |
| `press` | press | The press station only: start, stop, count (runs PR-10 and PR-1 are theirs) |
| `dieroom` | die_room | Die room: copies, readings, issue, nitriding, maker jobs, tier proposals |
| `packer` | packer | Pack, scan and dispatch on a phone (the packing bay tablet) |
| `operator` | operator | Packing sessions and labels (the floor, before the packer role existed) |
| `storekeeper` | storekeeper | The store: GRN and MRS |
| `foundry` | foundry | Casts: dev-press-cast-1 complete (locked melt, spectro passed, billets on hand), cast 3 open with a draft melt |
| `viewer` | viewer | Four KPIs on Today and read-only pages |
| `staff` | platform `super_admin` | Godseye: companies, builds, support inbox (one open request) |
| `party` | KD Extrusion portal | The party portal: KD's dispatches, certificate, sections, orders |

`apps/server/.dev.local-account.local` (gitignored) has `ORRN_LOCAL_EMAIL_{KEY}` for each of these and the
password; the e2e helpers read it (`signInViaApi(page, "packer")`).

## The plant in one picture

**Customers (6):** KD Extrusion (monthly party numbers, `26J12` style), Royal Aluminium (financial-year
party numbers, `2026-27/12`), Tejura & Sons (plant numbers), Shivam Bhavnagar, Apex Fabricators (no open
order), Mehta Windows.

**Sections (12)** from the catalogue (patti 14701, angle 11250 and 11262, tee 13090 and 13072, channel 12212
and 12230, patti 14715, flat 14730, angle 11280, tubes 15204 and 15310). Each has one to three copies
(`14701-1`, `14701-2`; Tee 13090 has 20: each e2e width mutates its own, nine are on trial). Five sections
have a heavier band (the ladder). Drift is computed by the server: green (up to +8 % over the band start),
amber (up to +10 %), red. Examples: 13090-1 green, 13090-2 amber, 13090-3 red on the heavy band, 14701-2
red (a lift to the heavier band is waiting for a manager), 11250-2 red and **at nitriding** (with its log),
12212-2 **at the die maker** (job DM-1 open), 12230 **owned by KD** (Tejura & Sons' exception on 12230-1 is approved; Royal is refused),
13090-11..19 **on trial**.

**Masters:** presses P1 and P2, furnace F1 (6 t, 127 mm), alloys 6063 and 6061 with their limits, three
transporters (one inactive), six yards, the default reason codes, shifts Day 08-20 and Night 20-08,
standards solid IS 733, hollow and semi hollow IS 1285 (CM/L left blank for the plant). **Settings the seed fills:**
a letterhead (legal name "Fourcubes Extrusions Pvt. Ltd. (Demo)", a format-valid dummy GSTIN `24AAACF4821J1ZV`, address, phone) and a support
contact (name, phone, hours), all dummy. **Die life** is set on five copies (13090-1, 13090-2, 13090-3, 12230-1, 14701-1).
The **spectro inbox** holds the simulator's file only; the collectors e2e adds and removes its own files (`POST /dev/spectro-file`).

### Orders (10): every state, figures that add up

Quantities of the newer orders are derived from the bundles on each line, so ordered, dispatched, packed,
held and baki always reconcile (a test checks `baki = max(0, ordered - dispatched)` on every line).

| Order | Customer | State | What it shows |
| --- | --- | --- | --- |
| SO-1 | KD | confirmed, **late** (25 d) | PO-4471; line 1 patti by pieces with 2 bundles packed; line 2 angle by kg (1,280 kg) |
| SO-2 | Royal | confirmed | 18 ft tee on the band-start basis (no reading on the copy yet) |
| SO-3 | KD | booking | no PO yet: the confirm checklist |
| SO-4 | KD | booking, **from the portal** | placed by `party` |
| SO-5 | Tejura | **closed** | two trucks, closed with a little baki and a reason; one combined packing list |
| SO-6 | Royal | **cancelled** | duplicate PO, with the reason |
| SO-7 | KD | **dispatching** | first truck went 4 days ago (invoice 271/26-27); packed angles wait; **two of them are asked to move to SO-9: a pending `order_reallocate`** |
| SO-8 | Royal | **dispatching** | opened a dispatch **from the order** today; copy 13090-1 pinned; **2 plant-stock tee bundles held** for line 1 |
| SO-9 | Tejura | confirmed | the reserved dispatch stands on lines 3 and 4; flat and angle stock packed; released plans cover lines 1, 2 and 5 |
| SO-10 | KD | confirmed | channel **12230, the die KD owns**; 8 bundles (BG-000009) packed for it: any other customer's dispatch of them is refused |

### Press (14 runs, 6 plans): today's board

Production day = 08:00 to 08:00. **P1:** PR-8 logged (the spec's worked example: 310.4 kg in, 234.2 kg good,
75.5 %), PR-11 logged (rejects: 38 kg to QC, 71.5 %, a die remark), PR-1 die issued, PR-2 and PR-14 queued
behind released plan PP-3. **P2:** PR-12 logged (a 62 minute container-heater stop), **PR-10 running now**
(angle 11250 on copy 11250-1), PR-13 queued (plan PP-4), **PR-9 a late entry waiting for approval**.
PR-11 and PR-12 are the single runs of the early plans PP-5 (patti, Press 1) and PP-6 (flat, Press 2), 100 % pressed, so their kg show on the order lines and the phone plan view. PR-3, PR-4 (queued tee) and PR-5..PR-7 (die trial runs on PP-2) are the die room's. All billets come from
cast `dev-press-cast-1`: its melt `dev-melt-1` charged 2,600 kg of LOT-6 and made 2,400 kg of logs (130 kg
dross, 20 kg Fe, 50 kg burnt), spectro passed; its ledger rows are what `melts.lock` posts and the three
logged runs' rows are what `press.runs.close` posts, so its close-out tail is 0. Cast 3
(`dev-press-cast-3`) is open with a draft melt `dev-melt-2` (1,500 kg of LOT-6 written, nothing posted).

### Ageing (2 batches on PR-8's line, 80 pcs)

Oven **OV-1**, trolleys **T-1** and **T-2**, recipes 6063 **T5** (240 min) and **T6** (360 min), both active. **AG-1** on T-1: 40 pcs,
released on the approved override `dev-approval-ageing-override-1` (the soak is always short in the seed, so this is the override
path); its line is the pack screen's trolley picker. **AG-2** on T-2: 30 pcs in OV-1 with the simulator curve logged up to now (the board's
oven card shows the stage timer and the line of readings). 10 pcs of the line are left to load. PR-8 has no order line, so no strip shows aged kg
from the seed; Today shows "In the oven: 1". `OVEN_SIMULATOR=1` (local only) adds the "Add simulated readings" button on a batch.

### Stock (129 bundles in 9 packing sessions)

Serials are `BG-000001-B001` style plus one plant-format clash on purpose (`26J1` is both a plant serial and
KD's first party number, so a scan of it is `ambiguous`). Every bundle has its **copy**, and a **cast** from session 3 on (sessions
6-8 from `dev-press-cast-1`, 3-5 from cast 2); KD's first truck predates cast numbers, so its certificate says
"bundles have no cast number". Of the 84 in stock: most stand on an order line, 13
are **plant stock** (a transfer to no line, D20; 2 of them also **held** for SO-8), the rest are on no order (legacy stock).
42 are dispatched, 10 reserved on the held dispatch, 3 void. The six yards all hold stock.
**CNT-1** (yards Y1 and Y2, closed two days ago): 2 phantoms nobody found, 1 code scanned that is in no
list, 1 bundle found in the wrong yard.

### Dispatch (6) and packing lists (6, PL v2)

| Dispatch | Customer | State | Notes |
| --- | --- | --- | --- |
| `dev-dispatch-done-1` | KD | completed | Shree Logistics, 9 t truck, invoice 271/26-27; PL **rev 1 and rev 2** under one number; party numbers `26J1..` |
| `dev-dispatch-done-2` | Royal | completed today | **opened from SO-8**, Balaji Roadways, 12 t |
| `dev-dispatch-done-3`, `-4` | Tejura | completed | two trucks for SO-5; their lists are folded into **one combined list** |
| `dev-dispatch-draft` | Shivam | **building** | 6 plant-stock bundles |
| `dev-dispatch-held` | Tejura | **held** (reserved) | 10 bundles on SO-9 lines 3 and 4 |

### Portal, printing, platform

`party@orrn.local` is KD's portal login with two granted sections (14701, 13090) plus the owned 12230, the
booking SO-4, and test certificate TC/.../1 on `dev-dispatch-done-1` (chemistry pending: no spectro). One
label template and printer ("Packing bay"), **two print jobs queued**, one edge node `pending` (never
connected) reporting **no scale** (`scale_configured = false`). A build per native platform, the pack
tablet, one support request, one succeeded backup run. **Store:** five items (Grain refiner, Degasser tablets, Silicon metal,
Container heater element, Hydraulic oil) with a GRN each and three issues (GRN-1..5, MRS-1..3). Scrap purchase: 8 vendors, 10 lots, one short lot with an approved D/C note.

### Approvals waiting (3)

`order_reallocate` (SO-7 to SO-9), `die_rerank` (lift 14701-2), `press_late_entry` (PR-9). The requester never
decides their own. The `die_owner_override` for Tejura & Sons on KD's 12230-1 is already approved (not waiting).
`dev-seed-demo-plant.test.ts` reads this heading and fails when the number drifts from the seed.

## A ten minute walk

1. **Today** as `owner`: packed today (30 bundles), 1 dispatch, pressed today (3 runs, recovery, 80 min stopped: an 18 min stop on P1 and a 62 min breakdown on P2; the 62 is cut short when the seed runs early in the production day).
2. **Orders:** SO-1 is late; open SO-7 (dispatching, baki), its pending move, then SO-8 (held, "Dispatch from order").
3. **Press** as `supervisor`: P2 has PR-10 running; PR-9 waits for `manager`; log a run.
4. **Die room** as `dieroom`: the Tee ladder, 11250-2 at nitriding, 12212-2 at the maker, 14701-2 proposal.
5. **Pack/Dispatch** as `packer` on a phone: scan plant stock onto the Shivam draft; the held dispatch for Tejura.
6. **Packing lists:** done-1 (two revisions), the combined Tejura list, SO-8's "original SO" column.
7. **Stock:** yards, CNT-1 and its two phantoms.
7a. **Ageing** as `press` (More, Ageing): the board (AG-2 soaking in OV-1, T-1 released), then Load trolley with the 10 pcs left, Start on a free trolley, add readings, Take out, record hardness; as `supervisor` Release, hold a line, ask for approval; as `manager` approve it in Approvals (the figures are in the sheet). Pack then lists the released line under "Trolley line"; the bundle page says "Aged" and links to its batch.
7b. **Ageing on the phone** (native, More, Ageing; first row for `press`, `supervisor`, `operator`, `manager`, `office`, `admin`): the board lists OV-1 with AG-2 (stage, last temperature, soak timer, a line of the log), T-1 and T-2, and the held batches first. As `press` or `operator`: Load trolley (T-1 or T-2 once free, or the 10 pcs left on PR-8; pieces default to all), open the batch, Start (recipe shown, gas meter), Add reading (a collector or simulator reading is listed read-only), Take out, Record hardness (the median is the server's). As `supervisor`: Release (the soak verdict panel says ok, under-aged or over-aged), Hold a line, Clear hold, Ask for approval. Age again, Discard the rest and Void are on the web: the batch screen names them under "Open on the web". Today carries an Ageing tile (in the oven, out, held); the bundle page shows "Aged" with its batch, and the void sheet says whether the pieces go back or are written off.
8. **Portal** as `party`: KD sees its own dispatch and certificate, never Royal's.
9. **Foundry** as `foundry` on a phone (W2-FD-W): Today's Foundry tile (open casts, melts in progress, spectro waiting), then
   `/casts`. Open the seeded cast 3 (open, a draft melt): the stepper opens on the draft's steps (times, charge of LOT-6,
   chemicals and LDO, logs and dross, spectro and lock); the last step lists what still stops the lock, each with a button to the
   step that fixes it. Type the spectro numbers with a reason (Fe 0.41 shows a fail against the 6063 limits), lock the melt, and
   the cast page's tail panel moves (billets made, used by the press, on hand, tail; burn and bundles stay beside it).
   Cast 1 is complete: the tail chip says every billet is accounted for, **Trace** shows LOT-6 in, the melt with its spectro,
   the press runs PR-8, PR-11 and PR-12 and the bundles that name the cast, and **Test certificate** is the staff copy.
   As `supervisor` close an empty or balanced cast; as `manager` open **Masters, Furnaces and Alloys** (limits editor),
   **Reports, Foundry yield**, and **Approvals** (a melt correction asked by foundry shows the melt's figures and a link).
   `/foundry/stock` lists billets on hand by alloy and cast.
10. **Foundry on the phone** (W2-FD-N). Sign in as `foundry`: the bar is Today, Cast, Scan, Stock, More. **Cast** opens on the newest
    open cast (cast 3, with its draft melt); the number, alloy, status and tail chip are large, and a row of cast numbers switches
    between open casts. Open the draft: tap **Furnace and times** (Charging start and Casting end are the big pair, **Now** fills the
    clock, **Show more** adds the other three), **Charge** (LOT-6 with its kg left, **All**), **Logs and dross** (the running
    burn and yield sit at the top), then **Spectro**: take a photo of the printout with **Attach a file or photo**, or **Type the numbers**
    with a reason (Fe 0.41 shows a fail). The list at the bottom says in the person's language what still stops **Lock melt**; each has
    a button to the part that fixes it. Lock, and the cast's tail chip moves. **Stock** shows **Billet stock** first (kg on hand by
    alloy, one card per cast; tap a card to open the cast). **Today** has the Foundry tile (open casts, drafts). Cast 1 is complete:
    its locked melt opens read only, with **Ask for a correction**. Sign in as `supervisor`: the bar is the packer bar, **More** has
    **Casts**; on an open cast with no draft melt **Close cast** counts the billets (pieces and kg), and a tail turns the chip amber and
    asks for a reason. Switch the phone to Hindi: every word on these screens changes, plant words (cast, melt, billet, kanta, LDO,
    spectro, dross) stay English.

## Ids that specs and tests rely on (do not rename)

`dev-company-orrn`, `dev-die-{code}` (`dev-die-14701`, `-13090`, `-11250`, `-12212`, `-14715`), `dev-customer-{kd,royal,tejura,...}`,
`dev-so-1..10`, `dev-sol-{order}-{line}`, `dev-dispatch-{draft,held,done-1..4}`, `dev-group-001..009`,
`dev-copy-{code}` (`dev-copy-14701-1`, `dev-copy-13090-1`), `dev-run-*` (`dev-run-14701-1` is PR-1,
`dev-run-12230-1` is PR-8), `dev-press-line-{1,2}`, `dev-press-cast-{1,2,3}`, `dev-melt-{1,2}`, `dev-plan-*`, `dev-count-1`,
`dev-approval-*`, `dev-portal-user-kd`, `dev-cert-done-1`, `dev-user-{key}`.

## Where it lives

`apps/server/src/dev-seed.ts` (orchestration, customers, bundles, dispatches, purchase, packing lists) and one
module per area: `dev-seed-orders.ts`, `dev-seed-dies.ts`, `dev-seed-press.ts`, `dev-seed-count.ts`,
`dev-seed-printing.ts`, `dev-seed-portal.ts`, `dev-seed-platform.ts`, `dev-seed-kit.ts` (time and chunking
helpers), `dev-accounts.ts` (logins and roles). Tests: `packages/server/test/dev-seed-demo-plant.test.ts`
(the plant in numbers, idempotence, seven moments in time) and the older per-module seed tests, which use
`test/dev-seed-fixture.ts` to create the logins.
