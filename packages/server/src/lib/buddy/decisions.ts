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
  } satisfies Record<string, BuddyDecision>,

  /**
   * Release 2 of the import (`feat/vision-read`, not merged yet). Decided ahead of the merge (§12.3); the
   * test accepts these paths missing from `appRouter` only because they are in this named list.
   */
  pending: {} satisfies Record<string, BuddyDecision>,
} as const;

export type BuddyRouterKey = keyof typeof BUDDY_DECISIONS.routers;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The decision for one procedure path. A path decision (or a pending one) wins; else the router's.
 * A router marked `"per-procedure"` with no path entry, or an unknown router, is denied (fail closed).
 */
export function decideBuddyPath(path: string): BuddyDecision {
  const paths = BUDDY_DECISIONS.paths as Record<string, BuddyDecision>;
  const pending = BUDDY_DECISIONS.pending as Record<string, BuddyDecision>;
  if (own(paths, path)) return paths[path]!;
  if (own(pending, path)) return pending[path]!;
  const top = path.split(".")[0] ?? "";
  const routers = BUDDY_DECISIONS.routers as Record<string, RouterDecision>;
  if (!own(routers, top)) return deny("No decision for this router yet.");
  const d = routers[top]!;
  if (d === "per-procedure") return deny("No decision for this procedure yet.");
  return d;
}

/** The refusal reason when an allowed path's input names a refused value, else null. */
export function refusedInput(decision: BuddyDecision, input: unknown): string | null {
  if (decision.kind !== "allow" || !decision.unless) return null;
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[decision.unless.field];
  return typeof value === "string" && decision.unless.values.includes(value) ? decision.unless.reason : null;
}
