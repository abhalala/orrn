# Owner handover: what only the owner can do

Updated during the FP continuation (2026-10-26 UTC). The feature inventory records implementation, not proof of
production or device readiness. Current verification and deployment evidence are in `.fp-build/LEDGER.md` and
`.fp-build/FINAL_REPORT.md`. Remaining work here needs an account, owner decision, plant data or a device;
open product follow-ups are in `TODO.md`, and commands are in `docs/DEPLOY_PROMOTION.md`.

Order that makes sense: 1 and 2 first (they unblock the dev site), then 4 to 7 with Dad and Lalu uncle, 3 when the plant says go.

## 1. Cloudflare account, optional R2 and the dev deploy

- **What:** the dev deploy of `b276f9cd` applied migrations 0010 to 0035 to the dev D1 and then stopped at the first R2 bucket
  (`403 Forbidden [10000] Authentication error`). That failed run did not update the app; consult the final report for the latest deployment.
- **Storage-free dev:** the dev workflow accepts the GitHub **dev environment** variable `ORRN_SKIP_R2=1`.
  It omits drawing/backup bindings deliberately; their screens and APIs say storage is not configured.
  Generic authentication failures are not silently interpreted as missing subscriptions.
- **Enable storage:** use the intended ORRN account, enable R2 with approved billing, grant the dev token
  Workers R2 Storage: Edit, remove the override and redeploy. Enabling the subscription does not attach Worker bindings.
- **Candidate:** the continuation integrates through migration 0042, including the two data steps described in the promotion runbook.
- **Pointers:** `docs/DEPLOY_PROMOTION.md` sections 0, 3 and 5; `docs/R2_BUCKETS.md`; `.fp-build/reports/promotion-20261025-0917.md`;
  `.fp-build/PROMOTE_QUEUE.md`.

## 2. Prod email

Resend remains the deployed provider; successful delivery is not established by the new optional Cloudflare sender seam.
Installed Alchemy 0.91.2 cannot serialize the Email Sending binding, so Cloudflare `EMAIL` is deliberately unbound.
Confirm Workers Paid/Email Sending entitlement and sending-domain DNS on the correct account, establish a supported
deployment binding, then verify an authorized real inbox before switching. Godseye retains copyable sign-in details.
See `docs/DEPLOY_PROMOTION.md`, “Transactional email readiness and handover”.

## 3. The prod go (explicit, every time)

Nobody pushes `prod` until you say so. When you do: take the D1 backup, run the duplicate-reason query for data step 1, merge the
sha you smoked on dev into `prod` with the promote commit, watch Deploy Production, smoke orrn.in with a real plant owner, take one
manual backup and run one restore drill. Commands: `docs/DEPLOY_PROMOTION.md` sections 1, 4 and 7; drill: `docs/RESTORE_DRILL.md`.
`redesign/c2` (the concepts checkout in `orrn/`) can merge `main` afterwards (section 2 of that file); it is not on the critical path.

## 4. Device bring-up (POST-FINAL, decision O9)

Native device work comes after the web is complete and dev is deployed. In order:

1. **Native build.** JDK 17 and the Android SDK, or EAS credentials; iOS and iPadOS through EAS and TestFlight (Apple developer
   account). A new development build is required (`expo-application`, `expo-crypto`, `expo-speech`). Publish it in Godseye under
   App builds. (`docs/DEPLOY_PROMOTION.md` section 6, `apps/native/README.md`.)
2. **Maestro.** Run the 10 flows in `.maestro/flows` on a real Android phone; none has ever been run.
3. **Device checks.** Camera capture for the foundry spectro photo (about 2.2 MP, re-encoded under 1 MB) and the camera permission
   flow, haptics, spoken refusals, a label printed from the phone, the press station on an 11-inch tablet, the ageing station on a
   phone.
4. **Press tablet.** The 30-minute WAN-pull test of the offline outbox.
5. **Phone gaps** that need no device are in `TODO.md` (BL 77 and the native follow-ups).

## 5. Plant hardware (each has a simulator today)

| Device | What to send | Question | Simulator |
|---|---|---|---|
| Packing-bay scale | Photo of the indicator and a 30 second capture: make, model, output mode (continuous ASCII over RS-232 or USB), baud. Until then a typed weight needs a reason. | Q5 | `SCALE_SIMULATOR=1`, `--scale-sim` in orrn-spool |
| TSC label printer | Label roll size and the real template; the QR `orrn.in/b/<no>?c=<slug>` is frozen. | Q31 | A4 sticker sheet |
| Press PLC | Make, protocol (Modbus TCP/RTU, OPC UA, S7), port, whether a read-only client is allowed, register or tag map with scaling, the network path PLC to spool PC to ORRN, how long raw frames are kept (default 90 days). Accept the 2 % variance rule. | Q46 | `--press-sim` |
| Spectrometer | One exported file, its columns, units and decimal separator, the export folder or share and credentials, and whether the lab writes cast numbers on samples. | Q47 | `--spectro-sim`, dev hook `POST /dev/spectro-file` |
| Furnace readings, billet weighing cell | Make and output of the furnace logger and the weighing cell. | Q46, Q27 | `FOUNDRY_SIMULATOR=1` |
| Ageing oven controller | Make, protocol and network path to the spool PC (AG-17 has the server route `POST /collector/ageing/readings`; there is no orrn-spool oven collector yet). | - | `OVEN_SIMULATOR=1` |

Guides for each flow are in `/guides` (44 in English and Hindi). Install and simulator commands: `docs/LOCAL_DEV.md`.

## 6. The spool repo (Go)

Merge `fp/scale-reader` and `fp/collectors` into orrn-spool `main` (Go 1.24 toolchain, none on the Mac: `docs/LOCAL_DEV.md`,
"Go toolchain"), install orrn-spool on the packing PC, point the node at ORRN so `/printing` shows the scale row. Print exactly
once (`print_log.id` as job key) is built on the ORRN side (BL 44, 53); the spool half is in the branch. The spool web UI
leftovers (webhook modals, AI designer, export, batch reprint stubs, template editor field names, assets offline, audit rows) are
later (BL 45).

## 7. Real data and the parallel run

- Import the section CSV (hyphen codes, never reuse a retired seq), legacy bundles as unassigned through `legacy_bundle_map`,
  die copies from the die room, drawings attached in bulk by file name (Q18).
- Set `castSeriesStart` in Settings > Standards > Cast numbers so the cast book continues from paper. An imported cast can also carry its legacy paper code on the Open cast form (FD-02).
- Confirm the real furnace and alloy limits (the seed has 6063 and 6061, Q-FD-1), the ageing recipes (seed 6063 T5 240 min and T6 360 min) and the oven and trolley masters.
- **Opening balances for the foundry's return streams.** A fresh plant has none, and a melt cannot take metal from a stream that
  has no stock ("Only N kg of <stream> is in stock"). Enter one opening per stream (ingot, plant scrap, discard, dross ingot, bend
  log, hill metal, pit metal, tendis, dross metal) once, on `/foundry/stock`, panel "Return streams" (`foundry.returnStreams.opening`,
  manager and above). Billets and scrap lots need no opening entry: billets come from locked melts (a paper-era cast is counted at close) and lots from the purchase book.
- Accounts for real people (plant admin is Dad, Q32); parallel run with FCMS until the clerk signs; PO strings kept as typed.
- Pilot and training: packing bay 1 week, die room desk 1 week, press tablet 2 weeks after a cast exists.

## 8. Language review

- **Gujarati** (decision O8, last priority): a native reader goes through `.fp-build/reports/gu-review-list-web.md` (12 word choices
  first) and `gu-review-list.md` (native), then flip `GUJARATI_DEFAULT_FOR_GUJARAT_PLANTS`. The translation agent's work is
  listed in `TODO.md` (loanwords, press and store namespaces, the nine new guides). Q48.
- **Hindi:** `docs/superpowers/review/hindi-review.md` (regenerated by `bun run --cwd packages/i18n export-review`).

## 9. Defaults taken that you may change (Q49 to Q63 are new)

Behaviour is built to the default and never blocked on an answer. Confirm, or change and an agent flips it: Q1 to Q4, Q6 to
Q20, Q23, Q25, Q37 (Dad has the final word on what a packing list may carry), Q42 to Q45, and these from the last round:

| Q | Subject | Default built |
|---|---|---|
| 49 | What the public die share page shows | section band(s) in g/12 ft and the best tier of live copies |
| 50 | Phone share link lifetime | always 7 days |
| 51 | Audit each view of a share link | count only ("Opened n times") |
| 52 | Who may share a die | anyone who can edit die files: owner, admin, manager, die room |
| 53 | Ageing sits between press and pack | no new bundle status; state derived from the trolley rows |
| 54 | Who loads trolleys and records readings | press, supervisor, operator |
| 55 | Who releases an aged batch | supervisor or manager |
| 56 | Soak verdict counts | minutes at recipe temperature within tolerance |
| 57 | Over-temperature grace | 15 minutes |
| 58 | A trolley is free again | when its batch closes |
| 59 | The tail at cast close | the foundry counts billets; tail = ledger on hand minus counted; above 3 % a second person approves |
| 60 | Void of a bundle packed from a batch that has since closed | pieces are written off as loose aged stock, the batch never reopens |
| 61 | Two live reasons with the same words in one kind | refused; retire one first |
| 62 | Label for a stopped run waiting for its log | "To log" |
| 63 | A copy now at nitriding as the source of a bundle packed later | allowed; the pack screen shows it with a status chip |

- **Q63** is worth a second look: the pack screen offers a copy that is now at nitriding for a bundle packed later from its earlier run (A, with a status chip); a copy at the die maker is refused by the server and hidden. Say B if nitriding copies should be refused too.

Also open for the owner: Q36 is answered (an off-band bundle needs approval) but the approval kind is still to build (`TODO.md`,
Next); the portal question of whether a party may see die drift and trial copies (BL 103).

The full text of every question is `.fp-build/OWNER_QUESTIONS.md`.

## 10. Housekeeping you may want

- The satellite branches `wt/W2-FD-S-omafranky`, `wt/W3-AG-C-omafranky` and `wt/SAT-*` are superseded (D32) and can be deleted.
- Orphan workerd processes of gone sessions can be killed; FINAL-FIXES-2 deleted stale shared Miniflare temp dirs during the disk-full stop (rule 15 now forbids it).
- Blume project registration failed on a workspace conflict (D4); delivery-level checkpoints work.
