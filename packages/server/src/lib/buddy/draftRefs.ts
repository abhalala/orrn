/**
 * Which record each id input of a draft names, which changes cannot be undone, and the bidi marks (delta round
 * decisions 5 and 10; review S4, security D-M2, D-L3). Pure: no database, so the card builder (`draftView.ts`) stays
 * pure; `draftNames.ts` turns the entities into names for this plant.
 *
 * - `refEntity(path, key)`: the entity a top-level id key names (`id` by router, `*Id`, `*Ids`), `null` when the key
 *   names a record with no name or code (listed in `NO_NAME` with the reason), `undefined` when the key is not known.
 *   `test/buddy-drafts-delta.test.ts` fails when an allowed change has an id key that is neither.
 * - `irreversiblePath(path)`: the change cannot be undone. Pinned per path in `buddy-procedures.snapshot.tsv`.
 */

export type RefEntity =
  | "ageingBatch"
  | "ageingOven"
  | "ageingRecipe"
  | "ageingRow"
  | "alloy"
  | "approval"
  | "artifact"
  | "bundle"
  | "candidate"
  | "cast"
  | "countSeen"
  | "countSession"
  | "customer"
  | "dcNote"
  | "die"
  | "dieBand"
  | "dieFile"
  | "dieInstance"
  | "dieIssue"
  | "dieMaker"
  | "dieMakerJob"
  | "dieShare"
  | "dispatch"
  | "dispatchItem"
  | "furnace"
  | "location"
  | "melt"
  | "member"
  | "packingList"
  | "pressAlert"
  | "pressDowntime"
  | "pressLine"
  | "pressPlan"
  | "pressPlanDie"
  | "pressPlanLine"
  | "pressRun"
  | "purchaseLot"
  | "reasonCode"
  | "returnStream"
  | "salesOrder"
  | "salesOrderLine"
  | "scrapGrade"
  | "scrapItem"
  | "spectroInbox"
  | "spectroResult"
  | "storeItem"
  | "storePoLine"
  | "storeTxn"
  | "transporter"
  | "trolley"
  | "vendor"
  | "vendorAlias";

/** The entity of a key, whatever the path (overridden per path below). */
const BY_KEY: Record<string, RefEntity> = {
  ageingRowId: "ageingRow",
  alloyId: "alloy",
  approvalId: "approval",
  artifactId: "artifact",
  bandId: "dieBand",
  batchId: "ageingBatch",
  bundleId: "bundle",
  bundleIds: "bundle",
  candidateId: "candidate",
  castId: "cast",
  customerId: "customer",
  dieId: "die",
  dieInstanceId: "dieInstance",
  dieMakerId: "dieMaker",
  dieOwnerApprovalId: "approval",
  dispatchId: "dispatch",
  furnaceId: "furnace",
  keepId: "vendor",
  lineId: "salesOrderLine",
  locationId: "location",
  locationIds: "location",
  lotId: "purchaseLot",
  meltId: "melt",
  mergeIds: "vendor",
  operatorId: "member",
  orderId: "salesOrder",
  ovenId: "ageingOven",
  ownerCustomerId: "customer",
  preferLineIds: "salesOrderLine",
  pressLineId: "pressLine",
  pressPlanDieId: "pressPlanDie",
  pressPlanLineId: "pressPlanLine",
  pressRunId: "pressRun",
  reasonCodeId: "reasonCode",
  recipeId: "ageingRecipe",
  reliefOperatorId: "member",
  rowId: "ageingRow",
  runId: "pressRun",
  salesOrderId: "salesOrder",
  salesOrderLineId: "salesOrderLine",
  sectionId: "die",
  seenIds: "countSeen",
  sessionId: "countSession",
  streamId: "returnStream",
  supervisorId: "member",
  toBandId: "dieBand",
  toLineId: "salesOrderLine",
  toLocationId: "location",
  transporterId: "transporter",
  trolleyId: "trolley",
  txnId: "storeTxn",
  vendorId: "vendor",
};

/** Keys whose entity depends on the path (`path:key`). */
const BY_PATH_KEY: Record<string, RefEntity> = {
  "dispatch.linkItem:itemId": "dispatchItem",
  "store.receive:itemId": "storeItem",
  "store.issue:itemId": "storeItem",
  "store.exchange:itemId": "storeItem",
  "store.receive:poLineId": "storePoLine",
  "purchase.lots.create:itemId": "scrapItem",
  "purchase.lots.update:itemId": "scrapItem",
};

/** What `id` names, by path prefix (longest prefix wins). */
const ID_BY_PREFIX: [string, RefEntity][] = (
  [
    ["customer.", "customer"],
    ["die.bands.", "dieBand"],
    ["die.share.", "dieShare"],
    ["die.", "die"],
    ["dieInstance.issues.", "dieIssue"],
    ["dieInstance.maker.jobs.", "dieMakerJob"],
    ["dieInstance.maker.", "dieMaker"],
    ["dieInstance.files.", "dieFile"],
    ["dieInstance.", "dieInstance"],
    ["bundle.", "bundle"],
    ["dispatch.", "dispatch"],
    ["packingList.", "packingList"],
    ["stock.locations.", "location"],
    ["store.items.", "storeItem"],
    ["vendor.removeAlias", "vendorAlias"],
    ["vendor.", "vendor"],
    ["purchase.scrapItems.", "scrapItem"],
    ["purchase.scrapGrades.", "scrapGrade"],
    ["purchase.lots.", "purchaseLot"],
    ["orders.", "salesOrder"],
    ["plans.", "pressPlan"],
    ["press.lines.", "pressLine"],
    ["press.runs.", "pressRun"],
    ["press.downtime.", "pressDowntime"],
    ["press.collector.acknowledgeAlert", "pressAlert"],
    ["ageing.ovens.", "ageingOven"],
    ["ageing.trolleys.", "trolley"],
    ["ageing.recipes.", "ageingRecipe"],
    ["reasonCodes.", "reasonCode"],
    ["foundry.furnaces.", "furnace"],
    ["foundry.alloys.", "alloy"],
    ["foundry.returnStreams.", "returnStream"],
    ["foundry.spectroInbox.", "spectroInbox"],
    ["foundry.spectro.", "spectroResult"],
    ["transporter.", "transporter"],
  ] as [string, RefEntity][]
).sort((a, b) => b[0].length - a[0].length);

/**
 * Id keys that name no record with a name or code, with the reason (`key` or `path:key`). An irreversible change may
 * carry one only when it is also in `NO_NAME_ON_IRREVERSIBLE` (the scan test enforces it).
 */
export const NO_NAME: Record<string, string> = {
  shiftId: "A shift of the plant settings (not a row); the card shows the id.",
  taxId: "The party's GSTIN, a value the person reads, not a reference to a row.",
  "store.issue:refId": "Free text the store keeper types (a machine or job), not a reference to a row.",
};
export const NO_NAME_ON_IRREVERSIBLE: readonly string[] = [];

/** The key of a resolved name in `DraftNames`: an id of one kind sent where another is expected finds no name. */
export const nameKey = (entity: RefEntity, id: string): string => `${entity}:${id}`;

/** The request keys Confirm sets to the draft id: hidden on the card, not references to a row. */
const REQUEST_KEY_NAMES = new Set(["clientRequestId", "clientMutationId"]);

/** `id`, or a camelCase key ending in `Id` or `Ids` (not a request key). */
export function isIdKey(key: string): boolean {
  if (REQUEST_KEY_NAMES.has(key)) return false;
  return key === "id" || /[a-z0-9]Ids?$/.test(key);
}

export const isIdList = (key: string): boolean => /[a-z0-9]Ids$/.test(key);

/** The entity an id key names; null when it names nothing with a name (`NO_NAME`); undefined when not an id key we know. */
export function refEntity(path: string, key: string): RefEntity | null | undefined {
  if (!isIdKey(key)) return undefined;
  const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  if (own(NO_NAME, `${path}:${key}`) || (own(NO_NAME, key) && !own(BY_PATH_KEY, `${path}:${key}`))) return null;
  if (own(BY_PATH_KEY, `${path}:${key}`)) return BY_PATH_KEY[`${path}:${key}`]!;
  if (key === "id") {
    for (const [prefix, entity] of ID_BY_PREFIX) if (path === prefix || path.startsWith(prefix)) return entity;
    return undefined;
  }
  return own(BY_KEY, key) ? BY_KEY[key]! : undefined;
}

/** Last path segments whose change cannot be undone (decision 5). */
const IRREVERSIBLE_VERBS = new Set([
  "archive",
  "cancel",
  "close",
  "complete",
  "delete",
  "discard",
  "discardRemaining",
  "dismiss",
  "lock",
  "merge",
  "remove",
  "removeAlias",
  "removeBundle",
  "removeScans",
  "retire",
  "revoke",
  "softDelete",
  "trialFail",
  "void",
]);

/** Whole paths that cannot be undone although their verb does not say so. */
const IRREVERSIBLE_PATHS = new Set<string>([
  // A paid model call on a page; it cannot be taken back.
  "ingest.vision.readPage",
]);

export function irreversiblePath(path: string): boolean {
  if (IRREVERSIBLE_PATHS.has(path)) return true;
  const last = path.split(".").pop() ?? "";
  return IRREVERSIBLE_VERBS.has(last);
}

/** Bidi controls (U+202A..U+202E, U+2066..U+2069). Never U+200C or U+200D (ZWNJ, ZWJ: normal in Devanagari and Gujarati). */
const BIDI = /[‪-‮⁦-⁩]/g;

export function hasBidi(text: string): boolean {
  BIDI.lastIndex = 0;
  const hit = BIDI.test(text);
  BIDI.lastIndex = 0;
  return hit;
}

/** Each bidi control shown as `⟦U+202E⟧`. */
export function markBidi(text: string): string {
  return text.replace(BIDI, (c) => `⟦U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}⟧`);
}
