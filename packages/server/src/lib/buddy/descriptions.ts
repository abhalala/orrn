/**
 * One line per procedure in plant words, for `orrn_search`, `orrn_describe` and the draft card title
 * (design 2026-11-18, §4.2). Hand-kept; a path missing here gets words built from the path. A missing
 * description is not a failure (`test/buddy-registry.test.ts` only lists them).
 */
export const buddyDescriptions: Record<string, string> = {
  // Import tools (§12.1).
  "ingest.status": "Import status: whether the file vault and the layout reader are set up, and open work.",
  "ingest.artifact.list": "List the import files and the state of each.",
  "ingest.artifact.get": "One import file: its tables, the period it covers and its state.",
  "ingest.candidate.list": "List the import tables (candidates) and their state.",
  "ingest.candidate.get": "One import table: what it is read as, its fit against the plant's data and open questions.",
  "ingest.rows.list": "The rows staged from an import table, with what was refused and why.",
  "ingest.rows.doubts": "Rows of an import table the importer is not sure about.",
  "ingest.hole.list": "What a finished merge left open.",
  "ingest.merge.get": "The state of a merge run.",
  "ingest.provenance.forRecord": "Which import file a record came from.",
  "ingest.shape.make": "Read the layout of an import table with the model (counts against the plant's model limits).",
  "ingest.period.confirm": "Answer the importer: the period (financial year or dates) an import file covers.",
  "ingest.answer.set": "Answer one of the importer's questions about an import table.",
  "ingest.rows.answerDoubts": "Answer the importer about rows it is not sure of.",
  "ingest.candidate.confirmNear": "Answer the importer: a near match is the same customer, die or vendor.",
  "ingest.candidate.setTarget": "Answer the importer: what kind of record an import table holds.",
  "ingest.candidate.hold": "Put an import table on hold.",
  "ingest.candidate.release": "Take an import table off hold.",
  "ingest.dryRun.step": "Try an import table against the plant's data without writing (dry run).",
  "ingest.vision.readPage": "Read one uploaded page image of a PDF or photo with the model.",
  "ingest.vision.pages": "The pages of a PDF or photo import and the state of each.",
  // XE PLATFORM row 91 ("Ask orrn"): plain words for the XE module reads, so the buddy finds them by the person's question.
  "approval.list": "What is pending for approval: requests waiting for a decision, with who asked and why.",
  "approval.facts": "The facts behind one approval request.",
  "dashboard.today": "Today's page: the day's numbers and what needs attention.",
  "dieInstance.list": "Die copies with their state, tier and where each is (store, press, die maker, nitriding).",
  "dieInstance.get": "One die copy: its state, tier, readings, nitriding and runs.",
  "dieInstance.issues.list": "Which die copies are issued to which press line, and which are due back.",
  "dieInstance.maker.jobs.list": "Die copies at the die maker and when they are due back.",
  "toolRoom.inspections.list": "Tooling inspections: which dies and tools are due for inspection and the last results.",
  "toolRoom.shortfalls": "Tooling and spares below their minimum stock.",
  "toolRoom.tooling.list": "Tooling pieces (bolsters, backers, rings) and their state.",
  "toolRoom.minStock.get": "Minimum stock set for tooling pieces.",
  "toolRoom.cost.byMaker": "Die cost by die maker (only for people who see die cost).",
  "toolRoom.copy": "Tool room details of one die copy.",
  "masters.lists.list": "The plant's shared lists: departments, designations, packing modes, die categories.",
  "masters.approvalRules.get": "Who approves each kind of request, and the limits.",
  "masters.numberFormats.get": "How the plant numbers its documents.",
  "masters.insurance.get": "The plant's transit insurance policy.",
  "masters.packing.forOrder": "The packing mode set for an order.",
  "docs.list": "The plant's document register: documents, their revision and expiry.",
  "complaints.list": "Customer complaints, open and closed.",
  "complaints.get": "One customer complaint with its investigation and reply.",
  "complaints.forBundle": "Complaints raised against one bundle.",
  "qa.today": "Quality today: checks done, holds and what waits for inspection.",
  "qa.checks.list": "Quality checks recorded (incoming, first piece, in process, dimensions, mechanical).",
  "qa.holds.list": "Bundles on quality hold.",
  "qa.holds.forBundle": "Whether a bundle is on quality hold, and why.",
  "qa.waiting.list": "Lots waiting at an inspection point.",
  "qa.instruments.list": "Measuring instruments and when each is due for calibration.",
  "qa.plans.list": "Quality plans per section.",
  "qa.plans.get": "One quality plan.",
  "qa.tempers.list": "The temper master.",
  "qa.substitutes.list": "Alloy substitutes the plant allows.",
  "qa.stations.list": "Inspection points.",
  "qa.settings.get": "The plant's quality settings.",
  "pricing.rates.current": "Today's metal rate and plant conversion (for people who see prices).",
  "pricing.rates.history": "How the metal rate and conversion changed over time.",
  "pricing.quotes.list": "Quotations sent to buyers and their state.",
  "pricing.quotes.get": "One quotation with its lines and prices.",
  "pricing.proforma.list": "Proforma invoices.",
  "pricing.enquiries.list": "Enquiries from buyers and their follow-ups.",
  "billing.invoices.list": "Tax invoices and credit notes (billing on).",
  "billing.invoices.get": "One tax invoice: amounts, IRN, e-way bill, payments against it.",
  "billing.invoices.billable": "Packing lists of completed dispatches not yet invoiced.",
  "billing.receivables.outstanding": "Outstanding from each customer: what is owed and how old it is.",
  "billing.receivables.statement": "A customer's statement: invoices, payments and the balance (outstanding from X).",
  "billing.receivables.openInvoices": "A customer's invoices not yet fully paid.",
  "billing.payments.list": "Payments received.",
  "roles.list": "The plant's custom roles and what each may do.",
  // Store buying (indents, purchase orders, store value) and plant maintenance, merged after this list began.
  "store.indents.list": "Indents: what departments asked the store to buy, and whether each is approved.",
  "store.indents.get": "One indent with its items, who asked and the decision.",
  "store.po.list": "Store purchase orders and their state.",
  "store.po.get": "One store purchase order: items, rates and what has been received.",
  "store.po.openLines": "Store purchase order items still to be received.",
  "store.valuation.items": "The store's average rate and value per item.",
  "store.valuation.month": "The store's stock value at month end.",
  "store.valuation.pending": "Goods received whose rate is still to be set.",
  "maint.today": "Maintenance for today: plans due, open breakdowns and flagged readings.",
  "maint.assets.list": "Machines and other assets in the maintenance register.",
  "maint.assets.get": "One asset: its plans, readings and work orders.",
  "maint.plans.due": "Preventive maintenance plans that are due or overdue.",
  "maint.workOrders.list": "Maintenance work orders and their state.",
  "maint.workOrders.get": "One work order: the job, the people, the spares and the times.",
  "maint.workOrders.breakdowns": "Breakdowns: machines that stopped and the work orders raised for them.",
  "maint.readings.list": "Machine readings taken (temperature, pressure and similar).",
  "maint.readings.flagged": "Machine readings outside their limits.",
  "maint.reports.summary": "Maintenance report for a month: breakdowns, downtime, work done and its cost.",
  // Composite import drafts (fix round decision 8): MCP tools orrn_import_answers and orrn_import_dry_run.
  "import.answerQuestions": "Answer the importer's questions about an import table, in this order.",
  "import.runDryRun": "Run the dry run of an import table to the end (nothing is written to the plant's data).",
};

const SPLIT = /(?<=[a-z0-9])(?=[A-Z])/;

/** Plain words from a path: `orders.lines.addLine` -> "orders: lines add line". */
export function wordsFromPath(path: string): string {
  const [head, ...rest] = path.split(".");
  const words = rest.flatMap((p) => p.split(SPLIT)).map((w) => w.toLowerCase());
  return words.length ? `${head}: ${words.join(" ")}` : (head ?? path);
}

export function describePath(path: string): string {
  return Object.prototype.hasOwnProperty.call(buddyDescriptions, path) ? buddyDescriptions[path]! : wordsFromPath(path);
}
