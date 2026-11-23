/**
 * What the buddy may reach on the tool leg (design 2026-11-18, §4.2, §10, §12.3). THE one allow/deny
 * constant: every top-level router of `appRouter` has a decision, every `ingest.*` procedure has its
 * own, and `test/buddy-registry.test.ts` fails when a router or an ingest procedure appears without one.
 *
 * - An allowed query runs at once under the person's grant (the normal middleware: `can()`, module gate,
 *   tenant scope). An allowed mutation never runs from the tool leg: it becomes a `buddy_draft` that the
 *   person confirms in the browser.
 * - A denied path is not a tool at all, not even as a draft: search never lists it, describe and call
 *   answer `not_found`, and `buddy.drafts.confirm` refuses a draft row that names it.
 *
 * Path decisions override the router's decision. A path decision for a procedure that does not exist is
 * refused by the test, except from `BUDDY_DECISIONS.pending` (paths of a branch that has not merged yet).
 */

export type BuddyDecision =
  | {
      kind: "allow";
      /** Refuse one input value of an allowed path (e.g. a CSV download of a report that is otherwise a read). */
      unless?: { field: string; values: readonly string[]; reason: string };
    }
  | { kind: "deny"; reason: string };

const allow: BuddyDecision = { kind: "allow" };
const deny = (reason: string): BuddyDecision => ({ kind: "deny", reason });

/** Router-level decisions. `"per-procedure"` = every path of the router must have its own entry below. */
type RouterDecision = BuddyDecision | "per-procedure";

export const BUDDY_DECISIONS = {
  routers: {
    healthCheck: deny("Not plant data; a probe for uptime checks."),
    privateData: deny("A sample procedure that echoes the session user."),
    auth: deny("Sign-in, passwords, passkeys and sessions (§4.2)."),
    waitlist: deny("Public sign-up requests, not plant data (§4.2)."),
    platform: deny("Platform staff only (§4.2)."),
    invite: deny("Inviting people changes members (§4.2)."),
    portal: deny("The customer portal and its logins (§4.2)."),
    spool: deny("Print node secrets and activation (§4.2)."),
    edge: deny("Edge node enrolment and tunnels (§4.2)."),
    device: deny("Phone registration and push tokens (§4.2)."),
    release: deny("App releases (§4.2)."),
    backup: deny("Whole-plant exports and restores (§4.2, §10 bulk export)."),
    support: deny("Support tickets go to platform staff (§4.2)."),
    buddy: deny("The buddy's own grants and drafts: browser session only, so Hermes cannot confirm its own drafts (§4.4)."),
    // XE PLATFORM row 91: billing reads (invoices, payments, outstanding) run under the person's grant, the same
    // `invoice.read` gate and opt-in module. No billing change is in `changes`, so every billing write stays denied;
    // the exports are denied by path below.
    billing: allow,
    einvoice: deny("IRN and e-way bills at the GST portal (XE-BILL)."),
    ingest: "per-procedure",

    company: allow,
    customer: allow,
    die: allow,
    dieInstance: allow,
    bundle: allow,
    dispatch: allow,
    packingList: allow,
    scale: allow,
    dashboard: allow,
    approval: allow,
    resolve: allow,
    stock: allow,
    count: allow,
    store: allow,
    vendor: allow,
    purchase: allow,
    analytics: allow,
    orders: allow,
    plans: allow,
    press: allow,
    ageing: allow,
    reasonCodes: allow,
    reports: allow,
    foundry: allow,
    audit: allow,
    transporter: allow,
    // XE parity lane REG: the complaint register's reads; its writes are named in `paths` (denied).
    complaints: allow,
    // XE parity lane ADM (wave 1). Kept from the buddy until the owner reviews them: bank accounts,
    // approver rules and number formats are plant settings, die cost is money, documents mint file links.
    // XE PLATFORM row 91: the ADM reads run under the person's grant (bank readers, die cost readers: the routers' own
    // gates). No ADM change is in `changes`, so settings writes stay denied. Bank account numbers and file links are
    // denied by path below.
    masters: allow,
    toolRoom: allow,
    docs: allow,
    // XE PLATFORM: custom roles. The list reads under `role.manage` / `users.manage`; every change is denied by name.
    roles: allow,
    // XE PLATFORM: plant API tokens and webhooks. Never readable or writable by the buddy (CONTRACTS-W3 item 6).
    api: deny("Plant API tokens and webhook secrets: never read or changed by the buddy (CONTRACTS-W3 item 6)."),
    // XE parity lane QA: reads (registers, holds, instruments). No quality change is listed in `changes`, so the
    // buddy cannot hold, release or record a check until the owner decides.
    qa: allow,
    // XE-PRICE: the price master, quotes, proformas, works orders and enquiries. Reads run under the
    // person's grant (the same `price.view` / `order.price` gates). No pricing change is in `changes`,
    // so every pricing mutation is denied to the buddy until it is decided by name.
    pricing: allow,
    // XE parity lane MAINT: maintenance reads (assets, plans due, work orders, readings, reports). Its writes are
    // denied by name in `paths` (a person sets up the register and raises and closes work orders).
    maint: allow,
    // XE parity lane COST: reads (cost per kg, capacity, forecast, dies due) run under the person's grant
    // (`cost.view`, and `order.price` for margins). The one change, the costing settings, is denied by name.
    costing: allow,
  } satisfies Record<string, RouterDecision>,

  paths: {
    // Members, roles and company settings (§4.2).
    "company.switch": deny("Changes which plant the person works in; the grant names one plant."),
    "company.updateSettings": deny("Company settings, including the secure sign-in policy (§4.2)."),
    "company.membersUpdateRole": deny("Changes a member's role (§4.2)."),
    "company.membersRemove": deny("Removes a member (§4.2)."),
    "foundry.casts.setSeriesStart": deny("Writes a company setting (the cast series start) (§4.2)."),

    // Owner decision 2 (2026-11-20): attestation acts stay a person's act on the screen, not even drafts.
    "approval.decide": deny("Approving or refusing a request is a person's act on the approvals screen (owner decision 2)."),
    "dieInstance.closeOwnerOverride": deny("The owner's override to close a die copy is a person's act on the die screen (owner decision 2)."),

    // The §10 scan: queries that write rows, call outside services, mint links or return bulk exports.
    "reasonCodes.list": deny("§10 scan: the read inserts the default reason codes on first use."),
    "press.reasons": deny("§10 scan: the read inserts the default reason codes on first use."),
    "dieInstance.work.kinds": deny("§10 scan: the read inserts the default reason codes on first use."),
    "press.collector.runSummary": deny("§10 scan: the read rebuilds the run's collector summary rows."),
    "dieInstance.files.url": deny("§10 scan: mints a signed file link, which would leave orrn through the chat."),
    "dieInstance.drawing": deny("§10 scan: mints a signed drawing link, which would leave orrn through the chat."),
    "press.runs.drawing": deny("§10 scan: mints a signed drawing link, which would leave orrn through the chat."),
    "scale.reading": deny("§10 scan: calls the print node over the network for a live scale reading."),
    "reports.salesRegisterCsv": deny("§10 scan: a month's sales register as a CSV download (bulk export with GSTINs)."),
    "foundry.spectro.file": deny("§10 scan: returns a stored spectro file as a download."),
    // Not tools by their nature: file bytes and public share pages stay in the browser (§12.2 by analogy).
    "dieInstance.files.beginUpload": deny("Die file upload: the bytes come from the browser only."),
    "dieInstance.files.commit": deny("Die file upload: the bytes come from the browser only."),
    "die.share.view": deny("The public share page, opened with a share token; not a plant tool."),
    // Delta round decision 1 (B1, D-M1): the link's token comes from the request key, which Confirm sets to the draft id
    // that Hermes and the audit log know. The buddy links the person to the die screen instead.
    // XE parity lane MAINT: every write is a person's act on the maintenance screens.
    "maint.assets.create": deny("The asset register is set up by a person on the maintenance screen."),
    "maint.assets.update": deny("The asset register is set up by a person on the maintenance screen."),
    "maint.assets.addFromMasters": deny("Adds assets in bulk; a person does it on the maintenance screen."),
    "maint.plans.create": deny("Preventive plans are set up by a person on the asset screen."),
    "maint.plans.update": deny("Preventive plans are set up by a person on the asset screen."),
    "maint.plans.makeWorkOrder": deny("Opening a work order is a person's act on the maintenance screen."),
    "maint.workOrders.create": deny("Raising a work order is a person's act on the maintenance screen."),
    "maint.workOrders.fromDowntime": deny("Raising a work order is a person's act on the press station or the maintenance screen."),
    "maint.workOrders.update": deny("The work done, the cause and the times are a person's record on the work order."),
    "maint.workOrders.move": deny("Moving or closing a work order is a person's act on the work order screen."),
    "maint.spares.link": deny("Spares are linked by a person on the work order screen."),
    "maint.spares.unlink": deny("Spares are linked by a person on the work order screen."),
    "maint.readings.createKind": deny("Reading limits are set up by a person on the asset screen."),
    "maint.readings.updateKind": deny("Reading limits are set up by a person on the asset screen."),
    "maint.readings.record": deny("A reading is taken by a person at the machine."),
    "maint.readings.makeWorkOrder": deny("Raising a work order is a person's act on the maintenance screen."),
    "maint.settings.set": deny("The labour rate is money; a person sets it on the maintenance screen."),
    "die.share.create": deny("Mints a public share link, which would leave orrn through the chat; the person makes it on the die screen."),
    // XE parity lane REG: a complaint's words go to the customer; a person writes them on the complaint screen.
    "complaints.open": deny("Raising a complaint is a person's act on the bundle or complaint screen."),
    "complaints.investigate": deny("The investigation is a person's record on the complaint screen."),
    "complaints.reply": deny("The reply goes to the customer; a person writes it on the complaint screen."),
    "complaints.close": deny("Closing a complaint is a person's act on the complaint screen."),
    "reports.ageing": {
      kind: "allow",
      unless: { field: "format", values: ["csv"], reason: "§10 scan: the CSV form is a download." },
    },
    "press.report": {
      kind: "allow",
      unless: { field: "format", values: ["csv"], reason: "§10 scan: the CSV form is a download." },
    },

    // Import tools (§12.1): reads run at once.
    "ingest.status": allow,
    "ingest.artifact.list": allow,
    "ingest.artifact.get": allow,
    "ingest.candidate.list": allow,
    "ingest.candidate.get": allow,
    "ingest.rows.list": allow,
    "ingest.rows.doubts": allow,
    "ingest.hole.list": allow,
    "ingest.merge.get": allow,
    "ingest.provenance.forRecord": allow,
    // Import tools (§12.1): drafts the person confirms.
    "ingest.shape.make": allow,
    "ingest.period.confirm": allow,
    "ingest.answer.set": allow,
    "ingest.candidate.confirmNear": allow,
    "ingest.candidate.setTarget": allow,
    "ingest.candidate.hold": allow,
    "ingest.candidate.release": allow,
    "ingest.dryRun.step": allow,
    // Never callable, not even as a draft (§12.3).
    "ingest.candidate.approve": deny("Approve stays a person's act on the review page."),
    "ingest.merge.start": deny("The final write of an import."),
    "ingest.merge.step": deny("The final write of an import."),
    "ingest.merge.stop": deny("The final write of an import."),
    "ingest.hole.retire": deny("A final change to what the merge left open."),
    "ingest.candidate.discard": deny("Discard of an artifact's table."),
    "ingest.artifact.begin": deny("Upload: file bytes come from the browser only (§12.2)."),
    "ingest.artifact.commitRaw": deny("Upload: file bytes come from the browser only (§12.2)."),
    "ingest.artifact.putBlocks": deny("Upload: parsed tables come from the browser only (§12.2)."),
    "ingest.artifact.putRows": deny("Upload: parsed rows come from the browser only (§12.2)."),
    "ingest.artifact.complete": deny("Upload: file bytes come from the browser only (§12.2)."),
    "ingest.rows.decide": deny("Row by row keep or refuse is a check against the file, made on the review page."),
    "ingest.rows.answerDoubts": deny(
      "\"Right\" on doubted rows records the person as having checked them; that check is made on the review page (owner decision 2).",
    ),
    "ingest.rows.skipNoDate": deny("Row by row keep or refuse is a check against the file, made on the review page."),
    "ingest.candidate.repickHeader": deny("The person picks the header row while they see the sheet."),
    "ingest.shape.save": deny("The person saves a layout while they see the sheet."),
    // Release 2 of the import (PR #12, merged 2026-11-21), moved here from `pending` at the rebase.
    "ingest.vision.readPage": allow,
    "ingest.vision.pages": allow,
    "ingest.vision.check": deny(
      "Sets model_checked, \"I checked these rows against the page\". A Confirm in the bubble does not show the page image, so the tick would mean nothing.",
    ),
    "ingest.vision.start": deny("Needs the page count from the PDF in the browser."),
    "ingest.vision.bandTickets": deny("Upload tickets for page images, which come from the browser only (§12.2)."),
    "ingest.vision.skipPage": deny("Skipping a page is a check against the page image, made in the browser."),
    "ingest.vision.typePage": deny("Typing a page is done against the page image, in the browser."),
    "ingest.vision.fixCell": deny("Fixing a cell is done against the page image, in the browser."),
    "ingest.vision.readUrl": deny("Mints a signed link to a page image; the image stays in the browser."),
    // Release 2 (PR #12, merged 2026-11-21): the upload parts and batch controls (review S8).
    "ingest.artifact.uploadStart": deny("Upload: file bytes come from the browser only (§12.2)."),
    "ingest.artifact.uploadTickets": deny("Upload tickets for file parts, which come from the browser only (§12.2)."),
    "ingest.artifact.uploadComplete": deny("Upload: file bytes come from the browser only (§12.2)."),
    "ingest.artifact.uploadAbort": deny("Upload: file bytes come from the browser only (§12.2)."),
    "ingest.vision.nextBatch": deny("Hands out page image tickets for the next batch; the images come from the browser only."),
    "ingest.vision.finishRest": deny("Skips the pages not read yet; that is a check against the pages, made in the browser."),
    "ingest.vision.waiting": allow, // "Tables waiting for a check", a read-only list.
    // XE parity lane QA: quality writes are a person's judgement at the piece or the gauge; not reviewed for the buddy yet.
    "qa.instruments.certificateUrl": deny("A signed link to a file; file bytes and links stay with the person (as die files)."),
    "qa.checks.record": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.holds.hold": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.holds.release": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.instruments.beginCertificate": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.instruments.calibrate": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.instruments.commitCertificate": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.instruments.save": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.plans.save": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.settings.update": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.stations.save": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.substitutes.remove": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.substitutes.save": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.tempers.save": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    "qa.waiting.place": deny("A quality decision made by a person at the material (XE QA); not reviewed for the buddy."),
    // XE PLATFORM row 91: what stays off the buddy inside the newly allowed XE routers (§10 scan).
    "masters.bank.list": deny("Bank account numbers stay off the chat; the person reads them on the Masters screen."),
    "docs.files.url": deny("§10 scan: mints a signed file link, which would leave orrn through the chat."),
    "billing.export.tally": deny("§10 scan: a bulk accounts export (a download), not a question."),
    "billing.export.salesRegister": deny("§10 scan: a month's sales register with GSTINs (bulk export)."),
    "billing.export.ewbJson": deny("§10 scan: the e-way bill JSON file for the portal (a download)."),
    // XE PLATFORM row 91: every billing change is denied by name until reviewed.
    "billing.hsn.assign": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.hsn.save": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.hsn.seedDefaults": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.invoices.createCreditDraft": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.invoices.createDraft": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.invoices.discard": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.invoices.issue": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.invoices.requestCancel": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.party.save": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.payments.record": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.payments.void": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    "billing.settings.save": deny("Billing writes: money and statutory numbers stay with people (XE-BILL); reads only (XE PLATFORM row 91)."),
    // XE PLATFORM row 91: every docs change is denied by name until reviewed.
    "docs.create": deny("Document register writes and uploads: a person on the screen (file bytes come from the browser only)."),
    "docs.files.beginUpload": deny("Document register writes and uploads: a person on the screen (file bytes come from the browser only)."),
    "docs.files.commit": deny("Document register writes and uploads: a person on the screen (file bytes come from the browser only)."),
    "docs.update": deny("Document register writes and uploads: a person on the screen (file bytes come from the browser only)."),
    // XE PLATFORM row 91: every masters change is denied by name until reviewed.
    "masters.approvalRules.set": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.bank.create": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.bank.setActive": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.bank.setDefault": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.bank.update": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.insurance.set": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.lists.addStarters": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.lists.create": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.lists.update": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.numberFormats.set": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.packing.setForDispatch": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.packing.setForLine": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    "masters.people.assign": deny("Plant masters and settings writes (§4.2): a person on the Masters screen; reads only (XE PLATFORM row 91)."),
    // XE PLATFORM row 91: every toolRoom change is denied by name until reviewed.
    "toolRoom.cost.set": deny("Tool room writes (die cost is money): a person on the screen; reads only (XE PLATFORM row 91)."),
    "toolRoom.inspections.record": deny("Tool room writes (die cost is money): a person on the screen; reads only (XE PLATFORM row 91)."),
    "toolRoom.minStock.set": deny("Tool room writes (die cost is money): a person on the screen; reads only (XE PLATFORM row 91)."),
    "toolRoom.sections.setCategory": deny("Tool room writes (die cost is money): a person on the screen; reads only (XE PLATFORM row 91)."),
    "toolRoom.tooling.create": deny("Tool room writes (die cost is money): a person on the screen; reads only (XE PLATFORM row 91)."),
    "toolRoom.tooling.update": deny("Tool room writes (die cost is money): a person on the screen; reads only (XE PLATFORM row 91)."),
    "roles.create": deny("Making a role changes what people may do; a person does it on the Roles screen."),
    "roles.update": deny("Editing a role changes what people may do; a person does it on the Roles screen."),
    "roles.delete": deny("Deleting a role changes what people may do; a person does it on the Roles screen."),
    "roles.assign": deny("Giving someone a role changes what they may do; a person does it on the People screen."),
    // XE-PRICE: every pricing change is denied by default (fix round 1 of PR #15); decide each by name to allow it.
    "pricing.rates.propose": deny("Proposes a master rate or a customer term; prices go through a person (XE-PRICE default deny)."),
    "pricing.settings.update": deny("Changes which metal list prices every order and the GST estimate (XE-PRICE default deny)."),
    "pricing.lines.requestOverride": deny("Writes or asks for an order-line rate (XE-PRICE default deny)."),
    "pricing.quotes.create": deny("Makes a numbered quote with prices (XE-PRICE default deny)."),
    "pricing.quotes.update": deny("Changes a quote's lines and prices (XE-PRICE default deny)."),
    "pricing.quotes.setStatus": deny("Sends or cancels a quote to a buyer (XE-PRICE default deny)."),
    "pricing.quotes.convert": deny("Turns a quote into a sales order with its prices (XE-PRICE default deny)."),
    "pricing.proforma.create": deny("Numbers a proforma with prices for a buyer (XE-PRICE default deny)."),
    "pricing.worksOrder.issue": deny("Numbers a works order for the floor (XE-PRICE default deny)."),
    "pricing.enquiries.create": deny("Writes an enquiry (XE-PRICE default deny until reviewed)."),
    "pricing.enquiries.update": deny("Changes an enquiry (XE-PRICE default deny until reviewed)."),
    // XE store (rows 69 to 72): buying (indents, purchase orders, the over-receipt tolerance) commits plant money; not reviewed for the buddy.
    "store.indents.approve": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.indents.cancel": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.indents.create": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.indents.fromReorder": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.indents.reject": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.po.cancel": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.po.close": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.po.create": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.po.issue": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.po.update": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.settings.setPoTolerance": deny("Buying store items commits plant money (XE store); not reviewed for the buddy."),
    "store.valuation.setGrnRate": deny("Sets the money a delivery is worth in the store's value (XE store); the office decides it from the bill."),
    "store.valuation.setOpeningRate": deny("Sets the money old stock is worth in the store's value (XE store); the office decides it."),
    // XE FOUNDRY (rows 41-47, 50): writes are denied by default until reviewed for drafts.
    "foundry.homog.create": deny("XE FOUNDRY write: homogenizing batch (not reviewed for drafts yet)."),
    "foundry.homog.addLine": deny("XE FOUNDRY write: homogenizing batch (not reviewed for drafts yet)."),
    "foundry.homog.removeLine": deny("XE FOUNDRY write: homogenizing batch (not reviewed for drafts yet)."),
    "foundry.homog.start": deny("XE FOUNDRY write: the furnace start takes the server clock on the floor."),
    "foundry.homog.reading": deny("XE FOUNDRY write: a furnace reading is read off the pyrometer on the floor."),
    "foundry.homog.out": deny("XE FOUNDRY write: homogenizing batch (not reviewed for drafts yet)."),
    "foundry.homog.release": deny("XE FOUNDRY write: the homogenizing verdict is a supervisor's act on the screen."),
    "foundry.homog.void": deny("XE FOUNDRY write: homogenizing batch (not reviewed for drafts yet)."),
    "foundry.logs.receive": deny("XE FOUNDRY write: posts bought-in logs to the stock ledger (not reviewed for drafts yet)."),
    "foundry.logs.beginMtc": deny("Mill test certificate upload: the bytes come from the browser only."),
    "foundry.logs.commitMtc": deny("Mill test certificate upload: the bytes come from the browser only."),
    "foundry.logs.mtcUrl": deny("§10 scan: mints a signed file link, which would leave orrn through the chat."),
    "foundry.billets.cut": deny("XE FOUNDRY write: posts a billet cut to the stock ledger (not reviewed for drafts yet)."),
    "foundry.billets.issue": deny("XE FOUNDRY write: moves billets on the stock ledger (not reviewed for drafts yet)."),
    "foundry.rejects.create": deny("XE FOUNDRY write: takes logs or billets out of stock (not reviewed for drafts yet)."),
    "foundry.chargeMix.setChemistry": deny("XE FOUNDRY write: a plant master (not reviewed for drafts yet)."),
    "foundry.castPlan.accept": deny("XE FOUNDRY write: casting plan (not reviewed for drafts yet)."),
    "foundry.castPlan.update": deny("XE FOUNDRY write: casting plan (not reviewed for drafts yet)."),
    "foundry.castPlan.drop": deny("XE FOUNDRY write: casting plan (not reviewed for drafts yet)."),
    "foundry.castPlan.open": deny("XE FOUNDRY write: opens a cast from the casting plan (not reviewed for drafts yet)."),
    // XE parity lane COST: default deny.
    "costing.settings.update": deny("Changes the plant's cost rates and the low-margin line (XE COST default deny)."),
  } satisfies Record<string, BuddyDecision>,

  /**
   * Review N2: every change (mutation) of an allowed router, reviewed by name. It runs only as a draft the person
   * confirms. A new mutation in an allowed router that is not here (or in `paths`) is denied, and
   * `buddy-registry.test.ts` names it until it is decided, so `BUDDY_SNAPSHOT_WRITE=1` can never stamp it as allowed.
   */
  changes: [
    "ageing.batches.discardRemaining", "ageing.batches.hardness", "ageing.batches.hold", "ageing.batches.load",
    "ageing.batches.out", "ageing.batches.release", "ageing.batches.requestOverride", "ageing.batches.rework",
    "ageing.batches.simulate", "ageing.batches.split", "ageing.batches.start", "ageing.batches.temp",
    "ageing.batches.unhold", "ageing.batches.void", "ageing.ovens.save", "ageing.recipes.save",
    "ageing.trolleys.save",
    "bundle.bulkImport", "bundle.createReceipt", "bundle.importCheck", "bundle.labelsPrinted",
    "bundle.transitionStatus",
    "count.cancel", "count.close", "count.removeScans", "count.resolve", "count.scan", "count.start",
    "customer.addAliases", "customer.create", "customer.delete", "customer.importCsv", "customer.update",
    "die.bands.create", "die.bands.retire", "die.bands.update", "die.create", "die.delete", "die.processImport",
    "die.share.revoke", "die.update", "die.validateImport",
    "dieInstance.addNitriding", "dieInstance.addReading", "dieInstance.create", "dieInstance.files.remove",
    "dieInstance.issues.cancel", "dieInstance.issues.issue", "dieInstance.issues.return",
    "dieInstance.maker.archive", "dieInstance.maker.create", "dieInstance.maker.jobs.cancel",
    "dieInstance.maker.jobs.receive", "dieInstance.maker.jobs.send", "dieInstance.maker.update",
    "dieInstance.nitridingBack", "dieInstance.nitridingOut", "dieInstance.proposeTier",
    "dieInstance.requestOwnerOverride", "dieInstance.trialFail", "dieInstance.trialPass", "dieInstance.update",
    "dieInstance.work.add",
    "dispatch.addBundle", "dispatch.addBundlesBySerial", "dispatch.cancel", "dispatch.complete", "dispatch.create",
    "dispatch.linkItem", "dispatch.removeBundle", "dispatch.reserve", "dispatch.scan", "dispatch.setItemGroupLabel",
    "dispatch.softDelete", "dispatch.unreserve", "dispatch.update",
    "foundry.alloys.create", "foundry.alloys.seedDefaults", "foundry.alloys.setLimits", "foundry.alloys.update",
    "foundry.casts.cancel", "foundry.casts.close", "foundry.casts.open", "foundry.furnaces.create",
    "foundry.furnaces.seedDefaults", "foundry.furnaces.update", "foundry.melts.cancel", "foundry.melts.correct",
    "foundry.melts.create", "foundry.melts.discard", "foundry.melts.lock", "foundry.melts.requestCorrection",
    "foundry.melts.save", "foundry.readings.add", "foundry.readings.simulate", "foundry.returnStreams.create",
    "foundry.returnStreams.opening", "foundry.returnStreams.seedDefaults", "foundry.returnStreams.update",
    "foundry.spectro.attach", "foundry.spectro.enter", "foundry.spectro.void", "foundry.spectroInbox.attach",
    "foundry.spectroInbox.dismiss",
    "orders.cancel", "orders.close", "orders.confirm", "orders.create", "orders.hold", "orders.quoteMany",
    "orders.reallocate", "orders.release", "orders.repriceWeight", "orders.update",
    "packingList.combine", "packingList.create", "packingList.regenerate",
    "plans.cancel", "plans.close", "plans.create", "plans.release", "plans.update",
    "press.collector.acknowledgeAlert", "press.collector.acknowledgeEndedAlerts", "press.collector.setThreshold",
    "press.downtime.start", "press.downtime.stop", "press.lines.create", "press.lines.restore", "press.lines.retire",
    "press.lines.update", "press.queue.move", "press.queue.pullBack", "press.queue.urgent", "press.runs.billets",
    "press.runs.close", "press.runs.confirmTime", "press.runs.count", "press.runs.handover", "press.runs.lines",
    "press.runs.open", "press.runs.qc", "press.runs.remark", "press.runs.reopen", "press.runs.resume",
    "press.runs.scrap", "press.runs.start", "press.runs.stop", "press.runs.undoStart", "press.runs.void",
    "purchase.dcNotes.create", "purchase.lots.advance", "purchase.lots.cancel", "purchase.lots.create",
    "purchase.lots.update", "purchase.scrapGrades.create", "purchase.scrapGrades.update",
    "purchase.scrapItems.create", "purchase.scrapItems.update", "purchase.seedScrapDefaults",
    "reasonCodes.create", "reasonCodes.rename", "reasonCodes.setActive",
    "stock.locations.create", "stock.locations.seedDefaults", "stock.locations.update", "stock.move",
    "stock.openingBalance",
    "store.cancel", "store.exchange", "store.issue", "store.items.create", "store.items.update", "store.receive",
    "transporter.create", "transporter.update",
    "vendor.addAlias", "vendor.confirm", "vendor.create", "vendor.merge", "vendor.removeAlias", "vendor.update",
  ] as readonly string[],

  /**
   * Release 2 of the import (`feat/vision-read`, not merged yet). Decided ahead of the merge (§12.3); the
   * test accepts these paths missing from `appRouter` only because they are in this named list.
   */
  pending: {} as Record<string, BuddyDecision>,
} as const;

export type BuddyRouterKey = keyof typeof BUDDY_DECISIONS.routers;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const CHANGES = new Set<string>(BUDDY_DECISIONS.changes);
const UNDECIDED_CHANGE = deny("A new change with no reviewed decision yet (review N2).");

/**
 * The decision for one procedure path. A path decision (or a pending one) wins; else the router's.
 * A router marked `"per-procedure"` with no path entry, or an unknown router, is denied (fail closed).
 * With `kind: "mutation"`, an allowed router's change must also be named in `changes` (review N2), else denied.
 */
export function decideBuddyPath(path: string, kind?: "query" | "mutation"): BuddyDecision {
  const paths = BUDDY_DECISIONS.paths as Record<string, BuddyDecision>;
  const pending = BUDDY_DECISIONS.pending as Record<string, BuddyDecision>;
  if (own(paths, path)) return paths[path]!;
  if (own(pending, path)) return pending[path]!;
  const top = path.split(".")[0] ?? "";
  const routers = BUDDY_DECISIONS.routers as Record<string, RouterDecision>;
  if (!own(routers, top)) return deny("No decision for this router yet.");
  const d = routers[top]!;
  if (d === "per-procedure") return deny("No decision for this procedure yet.");
  if (kind === "mutation" && d.kind === "allow" && !CHANGES.has(path)) return UNDECIDED_CHANGE;
  return d;
}

/** The refusal reason when an allowed path's input names a refused value, else null. */
export function refusedInput(decision: BuddyDecision, input: unknown): string | null {
  if (decision.kind !== "allow" || !decision.unless) return null;
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[decision.unless.field];
  return typeof value === "string" && decision.unless.values.includes(value) ? decision.unless.reason : null;
}
