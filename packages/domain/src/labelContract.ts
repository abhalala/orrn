/**
 * The label contract (BACKLOG 54, ADR-005, architecture SAD §8.3). Labels stay in the yard for months
 * and the rebuild must read whatever this system prints, so both halves are frozen here and pinned by
 * `labelContract.test.ts`:
 *
 * 1. The QR holds the bundle NUMBER only: `{origin}/b/{number}?c={companySlug}` (`bundleQrUrl`). Weight,
 *    section, tier and the bundle's database id are never encoded. Scanners read the number from the
 *    path (`parseScan` / `classifyCode`), so `{tenant}.orrn.in/b/{number}`, a bare number, an old
 *    month-only number (`J540`), a legacy FCMS cuid and a `BG-…` serial all keep resolving.
 * 2. The variables a spool label template may use are exactly `LABEL_VARIABLES`. No id-like variable
 *    (`uuid`, `id`, `bundleId`) is ever offered: a template could put it in the QR, and an id is not
 *    what a person or the rebuild can look up.
 */
export const LABEL_VARIABLES = [
  // buildBundleLabelVariables (server lib/bundle-label.ts)
  "length",
  "poNumber",
  "quantity",
  "serialNumber",
  "seriesName",
  "weight",
  "weight12ft",
  "weight_each",
  "layout",
  "cast",
  // buildPackLabelVariables (FP-PK-04/05)
  "qr",
  "salesOrder",
  "standard",
  "cml",
  "partyNo",
  "showLogo",
] as const;

export type LabelVariable = (typeof LABEL_VARIABLES)[number];

/** Names a label template must never be given (an id in a QR would outlive the number contract). */
export const FORBIDDEN_LABEL_VARIABLES = ["uuid", "id", "bundleId"] as const;
