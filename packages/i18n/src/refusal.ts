import type { MessageKey } from "./en";
import type { Translate, TranslateVars } from "./core";

/**
 * What a refused die room, orders or approval write says, in the person's language (BACKLOG 29, 43, 48).
 * The server's refusals are plain English sentences; a Hindi or Gujarati phone or browser must not show
 * or speak them. Every sentence the die room and orders routers can raise is matched here and said from
 * the dictionary (`refusal.*`). A sentence this build does not know shows a generic line in the person's
 * language and never the server's words. Pure and shared: apps/native (lib/server-refusal.ts) and
 * apps/web (features/shared/server-refusal.ts) both read this table. `refusal-sentences.ts` (test
 * support) parses the server source and each app's test fails on any sentence left unmapped.
 */

export type RefusalEntry = {
  /** The dictionary key is `refusal.<id>` unless `key` names another one. */
  id: string;
  re: RegExp;
  key?: MessageKey;
  /** The variables of the sentence; null when a word in it is not one this build knows (the generic line is shown). */
  vars?: (m: RegExpExecArray, t: Translate) => TranslateVars | null;
};

export const keyOf = (e: Pick<RefusalEntry, "id" | "key">): MessageKey => e.key ?? (`refusal.${e.id}` as MessageKey);

// ---------------------------------------------------------------------------
// Words the server puts in a sentence, said from our dictionary
// ---------------------------------------------------------------------------

const has = <T extends string>(list: readonly T[], x: string): x is T => (list as readonly string[]).includes(x);

const ORDER_WORDS = ["booking", "confirmed", "dispatching", "closed", "cancelled"] as const;
const PLAN_WORDS = ["draft", "released", "closed", "cancelled"] as const;
const BUNDLE_WORDS = ["available", "reserved", "dispatched", "void"] as const;

export const orderWord = (t: Translate, s: string): string | null => (has(ORDER_WORDS, s) ? t(`orders.status.${s}`) : null);
export const planWord = (t: Translate, s: string): string | null => (has(PLAN_WORDS, s) ? t(`press.plan.status.${s}`) : null);
export const bundleWord = (t: Translate, s: string): string | null => (has(BUNDLE_WORDS, s) ? t(`status.bundle.${s}`) : null);

/** The server's phrase for where a die copy is ("is out at nitriding") and the status it names. */
const COPY_PHRASE: Record<string, "available" | "in_use" | "at_nitriding" | "at_maker" | "on_trial" | "retired"> = {
  "is already issued to a press": "in_use",
  "is issued to a press": "in_use",
  "is out at nitriding": "at_nitriding",
  "is at the die maker": "at_maker",
  "is already at the die maker": "at_maker",
  "is on the rack": "available",
  "is on trial": "on_trial",
  "is retired": "retired",
};
const COPY_PHRASES = Object.keys(COPY_PHRASE)
  .sort((a, b) => b.length - a.length)
  .join("|");

const S = String.raw`(\S+)`;

/** "A (PR-1) and B (PR-2)" with the language's own "and". */
const holdersText = (holders: string, t: Translate) => holders.split(" and ").join(t("refusal.joinAnd"));


/** The server's English words for an ageing batch status (lib/ageingRefusals.ts AGEING_STATUS_PHRASE) and the key they mean. */
const AGEING_STATUS_PHRASE: Record<string, "loading" | "in_oven" | "out" | "released" | "held" | "closed" | "void"> = {
  loading: "loading",
  "in the oven": "in_oven",
  "out of the oven": "out",
  released: "released",
  held: "held",
  closed: "closed",
  void: "void",
};
const AGEING_PHRASES = Object.keys(AGEING_STATUS_PHRASE)
  .sort((a, b) => b.length - a.length)
  .join("|");
const ag = (id: string): MessageKey => `ageing.refusal.${id}` as MessageKey;

/**
 * Ageing (W3-AG-C): every sentence of `packages/server/src/lib/ageingRefusals.ts`, said from `ageing.refusal.*`.
 * First in the table: each is anchored on its own ending, so none takes a die room or orders sentence.
 */
const AGEING_REFUSALS_TABLE: readonly RefusalEntry[] = [
  { id: "ageingOvenNotActive", key: ag("ovenNotActive"), re: new RegExp(`^Oven ${S} is not in service$`), vars: (m) => ({ oven: m[1]! }) },
  { id: "ageingOvenBusy", key: ag("ovenBusy"), re: new RegExp(`^Oven ${S} already has a batch in it$`), vars: (m) => ({ oven: m[1]! }) },
  { id: "ageingOvenTooHot", key: ag("ovenTooHot"), re: new RegExp(`^Oven ${S} cannot run this recipe's temperature$`), vars: (m) => ({ oven: m[1]! }) },
  { id: "ageingTrolleyNotActive", key: ag("trolleyNotActive"), re: new RegExp(`^Trolley ${S} is not in service$`), vars: (m) => ({ code: m[1]! }) },
  { id: "ageingTrolleyBusy", key: ag("trolleyBusy"), re: new RegExp(`^Trolley ${S} is on ${S}; close or void that batch first$`), vars: (m) => ({ code: m[1]!, batch: m[2]! }) },
  { id: "ageingRecipeNotActive", key: ag("recipeNotActive"), re: /^Pick an active ageing recipe$/ },
  { id: "ageingRecipeMaxSoak", key: ag("recipeMaxSoak"), re: /^The over-age limit must be longer than the soak$/ },
  { id: "ageingRecipeHardnessMax", key: ag("recipeHardnessMax"), re: /^The hardness warning must be above the minimum$/ },
  { id: "ageingCodeTaken", key: ag("codeTaken"), re: new RegExp(`^The code ${S} is already used$`), vars: (m) => ({ code: m[1]! }) },
  { id: "ageingNoRows", key: ag("noRows"), re: /^Load at least one line on the trolley$/ },
  { id: "ageingTooManyRows", key: ag("tooManyRows"), re: /^Load at most (\d+) lines at a time$/, vars: (m) => ({ n: m[1]! }) },
  { id: "ageingRunNotLogged", key: ag("runNotLogged"), re: new RegExp(`^${S} is not logged yet; load its pieces after the log$`), vars: (m) => ({ run: m[1]! }) },
  { id: "ageingOverLine", key: ag("overLine"), re: /^Only (\d+) pieces of this press line are left to load$/, vars: (m) => ({ n: m[1]! }) },
  { id: "ageingManualOff", key: ag("manualOff"), re: /^Typed lines are off for this plant; load from a press run$/ },
  { id: "ageingBundleNotAvailable", key: ag("bundleNotAvailable"), re: new RegExp(`^Bundle ${S} is not in stock$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "ageingBundleOnBatch", key: ag("bundleOnBatch"), re: new RegExp(`^Bundle ${S} is already on ${S}$`), vars: (m) => ({ serial: m[1]!, batch: m[2]! }) },
  { id: "ageingBundleAlreadyAged", key: ag("bundleAlreadyAged"), re: new RegExp(`^Bundle ${S} is already aged$`), vars: (m) => ({ serial: m[1]! }) },
  {
    id: "ageingAlloyMismatch",
    key: ag("alloyMismatch"),
    re: new RegExp(`^Cast ${S} is alloy ${S}; this recipe is for ${S}$`),
    vars: (m) => ({ cast: m[1]!, alloy: m[2]!, recipeAlloy: m[3]! }),
  },
  {
    id: "ageingTemperMismatch",
    key: ag("temperMismatch"),
    re: new RegExp(`^This line is temper ${S}; this recipe is for ${S}$`),
    vars: (m) => ({ temper: m[1]!, recipeTemper: m[2]! }),
  },
  {
    id: "ageingWrongStatus",
    key: ag("wrongStatus"),
    re: new RegExp(`^${S} is (${AGEING_PHRASES}); that step is not open now$`),
    vars: (m, t) => ({ batch: m[1]!, status: t(`ageing.status.${AGEING_STATUS_PHRASE[m[2]!]!}`) }),
  },
  { id: "ageingNoShifts", key: ag("noShifts"), re: /^Add shifts in Settings before starting a batch$/ },
  { id: "ageingShiftUnknown", key: ag("shiftUnknown"), re: /^Pick a shift of this plant$/ },
  { id: "ageingTimeFuture", key: ag("timeFuture"), re: /^That time is in the future$/ },
  { id: "ageingBackdateTooFar", key: ag("backdateTooFar"), re: /^A time can go back at most 12 hours$/ },
  { id: "ageingGasEndBelowStart", key: ag("gasEndBelowStart"), re: /^Gas end is below gas start$/ },
  { id: "ageingNoReading", key: ag("noReading"), re: /^Record a temperature before taking the batch out$/ },
  { id: "ageingOutBeforeIn", key: ag("outBeforeIn"), re: /^The out time must be after the in time$/ },
  { id: "ageingReadingClosed", key: ag("readingClosed"), re: /^Readings close 30 minutes after the batch comes out$/ },
  { id: "ageingReadingBeforeIn", key: ag("readingBeforeIn"), re: /^That reading is before the batch went in$/ },
  { id: "ageingOverridePending", key: ag("overridePending"), re: new RegExp(`^${S} already has an override waiting for approval$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingOverrideNotNeeded", key: ag("overrideNotNeeded"), re: new RegExp(`^${S} passed; it needs no override$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingAlreadyHeld", key: ag("alreadyHeld"), re: /^This trolley line is already held$/ },
  { id: "ageingHoldAfterPack", key: ag("holdAfterPack"), re: /^Pieces were packed from this trolley; hold the lines that are still full$/ },
  { id: "ageingVoidInOven", key: ag("voidInOven"), re: new RegExp(`^${S} is in the oven; take it out first$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingVoidAfterPack", key: ag("voidAfterPack"), re: new RegExp(`^Pieces were packed from ${S}; it cannot be voided$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingVoidReasonMissing", key: ag("voidReasonMissing"), re: /^Say why this batch is voided$/ },
  { id: "ageingNothingToRework", key: ag("nothingToRework"), re: /^No held pieces are left to age again$/ },
  { id: "ageingDiscardOver", key: ag("discardOver"), re: /^Only (\d+) pieces are left on this trolley line$/, vars: (m) => ({ n: m[1]! }) },
  { id: "ageingSplitOff", key: ag("splitOff"), re: /^Splitting lengths is off for this plant$/ },
  { id: "ageingSplitAfterPack", key: ag("splitAfterPack"), re: /^Pieces were packed from this trolley line; it cannot be split$/ },
  { id: "ageingSplitLength", key: ag("splitLength"), re: /^The cuts must add up to the loaded length$/ },
  { id: "ageingNotReleased", key: ag("notReleased"), re: /^This trolley line is not released; it is not on the pack list$/ },
  { id: "ageingBundleInAgeing", key: ag("bundleInAgeing"), re: new RegExp(`^Bundle ${S} is in ageing on ${S}$`), vars: (m) => ({ serial: m[1]!, batch: m[2]! }) },
  { id: "ageingBundleAgeingHeld", key: ag("bundleAgeingHeld"), re: new RegExp(`^Bundle ${S} is held in ageing on ${S}$`), vars: (m) => ({ serial: m[1]!, batch: m[2]! }) },
  {
    id: "ageingBundleNotAged",
    key: ag("bundleNotAged"),
    re: new RegExp(`^Bundle ${S} is not aged; this plant dispatches aged metal only$`),
    vars: (m) => ({ serial: m[1]! }),
  },
  { id: "ageingBatchNotFound", key: ag("batchNotFound"), re: /^Ageing batch not found$/ },
  { id: "ageingOvenNotFound", key: ag("ovenNotFound"), re: /^Ageing oven not found$/ },
  { id: "ageingTrolleyNotFound", key: ag("trolleyNotFound"), re: /^Trolley not found$/ },
  { id: "ageingRecipeNotFound", key: ag("recipeNotFound"), re: /^Ageing recipe not found$/ },
];

/** Order matters: the specific sentences come before the general ones. */
export const SERVER_REFUSALS: readonly RefusalEntry[] = [
  // --- ageing (W3-AG-C) ------------------------------------------------------
  ...AGEING_REFUSALS_TABLE,

  // --- not found -----------------------------------------------------------
  { id: "notFoundDie", re: /^(?:Die|Die copy|Section|Band) not found$/ },
  { id: "notFoundIssue", re: /^Die issue not found$/ },
  { id: "notFoundRun", re: /^Press run not found$/ },
  { id: "notFoundPress", re: /^Press line not found$/ },
  { id: "notFoundMaker", re: /^Die maker(?: job)? not found$/ },
  { id: "notFoundOrder", re: /^Order(?: line)? not found$/ },
  { id: "notFoundBundle", re: /^Bundle not found$/ },
  { id: "notFoundPlan", re: /^Press plan not found$/ },
  { id: "notFoundCustomer", re: /^Customer not found$/ },
  { id: "notFoundOrder", re: /^Reallocation not found$/ },
  { id: "notFound", key: "errors.notFound", re: /^Not found$/ },

  // --- the same thing changed under the person -------------------------------
  { id: "changed", re: /\bmeanwhile\b|changed while you were editing it|^The section changed; try again$/ },

  // --- die copy state ---------------------------------------------------------
  { id: "retiredNoReadings", re: new RegExp(`^${S} is retired; it takes no readings$`), vars: (m) => ({ code: m[1]! }) },
  { id: "retired", re: new RegExp(`^${S} is retired$`), vars: (m) => ({ code: m[1]! }) },
  { id: "sectionDeleted", re: new RegExp(`^${S}'s section is deleted; it cannot be issued$`), vars: (m) => ({ code: m[1]! }) },
  { id: "copyOnTrialIssue", re: new RegExp(`^${S} is on trial; it goes only to a die trial run until the trial passes or a manager releases it$`), vars: (m) => ({ code: m[1]! }) },
  { id: "onTrialRelease", re: new RegExp(`^${S} is on trial; it becomes available when a trial passes, or a manager releases it$`), vars: (m) => ({ code: m[1]! }) },
  {
    id: "copyState",
    re: new RegExp(`^${S} (${COPY_PHRASES})(?:; it cannot be [a-z ]+)?$`),
    vars: (m, t) => ({ code: m[1]!, state: t(`dieRoom.status.${COPY_PHRASE[m[2]!]!}`) }),
  },
  { id: "alreadyIssued", re: new RegExp(`^${S} is already issued to ${S}$`), vars: (m) => ({ code: m[1]!, line: m[2]! }) },
  { id: "runHasDie", re: new RegExp(`^${S} already has a die or has started; only a queued run takes a die$`), vars: (m) => ({ run: m[1]! }) },
  { id: "notCopyOfRunDie", re: new RegExp(`^${S} is not a copy of the die ${S} needs$`), vars: (m) => ({ code: m[1]!, run: m[2]! }) },
  { id: "runOtherLine", re: new RegExp(`^${S} is planned on another press line$`), vars: (m) => ({ run: m[1]! }) },
  { id: "dieOnPress", re: new RegExp(`^${S} is in the press for ${S}; take the die out first$`), vars: (m) => ({ code: m[1]!, run: m[2]! }) },
  { id: "issueClosed", re: /^This issue is already (?:returned|cancelled)$/ },
  { id: "runStartedReturn", re: new RegExp(`^${S} has started; return the die when it is out$`), vars: (m) => ({ run: m[1]! }) },
  { id: "editIssued", re: new RegExp(`^${S} is issued to a press; return it before editing the card$`), vars: (m) => ({ code: m[1]! }) },
  { id: "editAtMaker", re: new RegExp(`^${S} is at the die maker; receive it before editing the card$`), vars: (m) => ({ code: m[1]! }) },
  { id: "nitridingStepOnly", re: new RegExp(`^Send ${S} to nitriding from its card's nitriding step, not by editing its status$`), vars: (m) => ({ code: m[1]! }) },
  { id: "backFromNitridingFirst", re: new RegExp(`^${S} is out at nitriding; record it back from nitriding first$`), vars: (m) => ({ code: m[1]! }) },
  { id: "badStatusMove", re: new RegExp(`^${S} is [a-z ]+; it cannot be set to [a-z ]+ from there$`), vars: (m) => ({ code: m[1]! }) },
  { id: "notAtNitriding", re: new RegExp(`^${S} is not out at nitriding$`), vars: (m) => ({ code: m[1]! }) },
  { id: "notOnTrial", re: new RegExp(`^${S} is not on trial$`), vars: (m) => ({ code: m[1]! }) },
  { id: "stillOnPress", re: new RegExp(`^${S} is still on the press; take the die out and return it first$`), vars: (m) => ({ code: m[1]! }) },
  { id: "tierPending", re: new RegExp(`^${S} already has a tier change waiting for approval$`), vars: (m) => ({ code: m[1]! }) },
  { id: "alreadyTier", re: new RegExp(`^${S} is already (?:on that band|tier \\d+)$`), vars: (m) => ({ code: m[1]! }) },

  // --- die, tier, nitriding and card input --------------------------------------
  { id: "ownerSetManager", re: /^Only a manager or admin can set who owns a die$/ },
  { id: "sectionOwned", re: /^This section belongs to a customer; its copies cannot be given to someone else/ },
  { id: "pickMaker", re: /^Pick an active die maker$/ },
  { id: "sectionArchived", re: /^This section is archived; no new die copies$/ },
  { id: "newOnRack", re: /^A new copy starts on the rack; send it to nitriding from its card$/ },
  { id: "newOnTrial", re: /^A new copy starts on trial; a manager can release it once it has passed$/ },
  { id: "pickBand", re: /^(?:Pick a band of this section|The lift target must be an active band of this section)$/ },
  { id: "nitridingFuture", re: /^The nitriding date is in the future$/ },
  { id: "bandOnlyLift", re: /^A band is only given with a lift$/ },
  { id: "pickTier", re: /^Pick a tier(?: for this copy first)?$/ },
  { id: "chemicalUnused", re: /^Nothing was used of (.+); leave its store item empty$/, vars: (m) => ({ name: m[1]! }) },
  { id: "itemNotKg", re: /^(.+) is counted in (.+); pick a store item counted in kg$/, vars: (m) => ({ item: m[1]!, unit: m[2]! }) },
  { id: "pickCopy", re: /^Pick the die(?: copy)?$/ },
  { id: "sectionNoCopies", re: /^This section has no copies$/ },
  { id: "copyNotOfDie", re: /^This copy is not of that die$/ },
  { id: "pickCustomer", re: /^Pick a customer of this plant$/ },
  { id: "listStale", re: /^This list page is out of date; reload the list$/ },
  { id: "plantOwned", re: new RegExp(`^${S} is plant-owned; no exception is needed$`), vars: (m) => ({ code: m[1]! }) },
  { id: "ownerNoException", re: /^(.+) owns (\S+); no exception is needed$/, vars: (m) => ({ name: m[1]!, code: m[2]! }) },
  { id: "exceptionOpen", re: /^(.+) already has an open exception on (\S+)$/, vars: (m) => ({ name: m[1]!, code: m[2]! }) },
  { id: "exceptionAsked", re: /^(.+) already asked for an exception on (\S+); it is waiting for approval$/, vars: (m) => ({ name: m[1]!, code: m[2]! }) },
  { id: "exceptionClosed", re: /^(?:Only an approved exception can be closed|This exception is already closed)$/ },
  { id: "releaseManagerOnly", re: /^Only a manager can release a copy without a passed trial$/ },
  { id: "releaseWhy", re: /^Say why this copy is released without a trial$/ },
  { id: "retireRoleOnly", re: /^Only the die room or a manager can retire a copy$/ },
  { id: "noPermission", key: "errors.forbidden", re: /^You don't have permission to (?:do that|set rates)$/ },

  // --- die makers and trials -------------------------------------------------------
  { id: "makerNameTaken", re: /^A die maker named (.+) already exists$/, vars: (m) => ({ name: m[1]! }) },
  { id: "nameLetters", re: /^Name needs letters or digits$/ },
  { id: "makerOpenJob", re: new RegExp(`^${S} is still with (.+)$`), vars: (m) => ({ number: m[1]!, name: m[2]! }) },
  { id: "makerArchived", re: /^(.+) is archived$/, vars: (m) => ({ name: m[1]! }) },
  { id: "jobClosed", re: new RegExp(`^${S} is already (?:received|cancelled)$`), vars: (m) => ({ number: m[1]! }) },
  { id: "notTrialRun", re: new RegExp(`^${S} is not a die trial run$`), vars: (m) => ({ run: m[1]! }) },
  { id: "didNotPress", re: new RegExp(`^${S} did not press ${S}$`), vars: (m) => ({ run: m[1]!, code: m[2]! }) },
  { id: "trialNotClosed", re: new RegExp(`^${S} is not closed yet; close the trial first$`), vars: (m) => ({ run: m[1]! }) },
  { id: "trialResult", re: new RegExp(`^${S} (?:has no trial result|was marked \\w+, not \\w+)$`), vars: (m) => ({ run: m[1]! }) },

  // --- die cards, bands and files (the die room's other routers) -----------------------
  { id: "minOverMax", re: /^Min weight cannot be greater than max weight$/ },
  { id: "dieExists", re: /^(?:A|Another) die with this series and section code already exists$/ },
  { id: "copyOwnerClash", re: new RegExp(`^${S} belongs to another customer; clear that copy's owner first$`), vars: (m) => ({ code: m[1]! }) },
  {
    id: "bandExists",
    re: new RegExp(`^${S} already has (?:the primary band|a band|7) ([\\d.]+)-([\\d.]+) at ([\\d.]+) mm\\. Add the copy to that band instead\\.$`),
    vars: (m) => ({ code: m[1]!, min: m[2]!, max: m[3]!, wall: m[4]! }),
  },
  { id: "bandRetired", re: /^This band is retired$/ },
  { id: "copyOnBand", re: new RegExp(`^${S} is still on this band; lift it to another band first$`), vars: (m) => ({ code: m[1]! }) },
  { id: "liftWaiting", re: /^A lift to this band is waiting for approval$/ },
  { id: "bandRaced", re: /^A copy was put on this band; try again$/ },
  {
    id: "lineFullDieOut",
    re: new RegExp(`^${S} already has (.+)\\. Take one back, or record the die out of ${S}, before issuing ${S}\\.$`),
    vars: (m, t) => ({ line: m[1]!, holders: holdersText(m[2]!, t), out: m[3]!, copy: m[4]! }),
  },
  {
    id: "lineFull",
    re: new RegExp(`^${S} already has (.+)\\. Take one back before issuing ${S}\\.$`),
    vars: (m, t) => ({ line: m[1]!, holders: holdersText(m[2]!, t), copy: m[3]! }),
  },
  { id: "pickSectionOrCopy", re: /^Pick a section or a die copy$/ },
  { id: "copyOtherSection", re: /^This die copy belongs to another section$/ },
  { id: "drawingPdf", re: /^(?:The press drawing must be a PDF|Only a section's PDF can become its press drawing)$/ },
  { id: "drawingOfSection", re: /^The press drawing belongs to the section, not one copy$/ },
  { id: "uploadExpired", re: /^This upload has expired; pick the file again$/ },
  { id: "fileNotFound", re: /^(?:Upload|File) not found$/ },
  { id: "fileSaved", re: /^This file is already saved$/ },
  { id: "fileNotArrived", re: /^The file has not arrived; upload it again$/ },
  { id: "fileNotWhole", re: /^The file did not arrive whole; upload it again$/ },
  { id: "storageOff", re: /^File (?:storage is|links are) not set up for this plant yet$/ },
  { id: "fileEmpty", re: /^The file is empty$/ },
  { id: "fileTooBig", re: /^This \w+ is larger than (\d+)(?: MB)?$/, vars: (m) => ({ mb: m[1]! }) },
  { id: "imageTypes", re: /^Images must be JPEG, PNG or WebP$/ },
  { id: "notPdf", re: /^This is not a PDF$/ },
  { id: "pickFileKind", re: /^Pick a \.(\w+) file$/, vars: (m) => ({ kind: m[1]! }) },

  // --- who owns the die ----------------------------------------------------------------
  { id: "owned", re: /^This die belongs to another customer$/, key: "refusal.ownedOther" },
  { id: "owned", re: /^This die belongs to (.+)$/, vars: (m) => ({ name: m[1]! }) },

  // --- approvals --------------------------------------------------------------------------
  { id: "alreadyDecided", re: /^This request was already decided$/ },
  { id: "ownRequest", re: /^Someone else has to approve your request$/ },

  // --- orders ----------------------------------------------------------------------------
  { id: "poRepeat", key: "orders.poRepeat", re: /^PO (.+) is already on (\S+) for this customer$/, vars: (m) => ({ po: m[1]!, code: m[2]! }) },
  { id: "poOther", re: /^PO (.+) is already on another order of this customer$/, vars: (m) => ({ po: m[1]! }) },
  { id: "copyNotLive", re: /^(?:Line \d+: )?[Tt]hat copy is not a live copy of (.+)$/, vars: (m) => ({ section: m[1]! }) },
  { id: "onlyBookingConfirm", re: /^Only a booking can be confirmed \(this order is (\w+)\)$/, vars: (m, t) => word("status", orderWord(t, m[1]!)) },
  { id: "cantClose", re: /^An? (\w+) order can't be closed$/, vars: (m, t) => word("status", orderWord(t, m[1]!)) },
  { id: "bakiReason", re: /^([\d.,]+) kg baki is left on this order\. Give a reason to close it\.$/, vars: (m) => ({ kg: m[1]! }) },
  { id: "cantCancel", re: /^An? (\w+) order can't be cancelled$/, vars: (m, t) => word("status", orderWord(t, m[1]!)) },
  { id: "cancelCarried", re: /^Bundles, a press plan or a dispatch already carry this order\. Close it instead of cancelling\.$/ },
  { id: "cantChange", re: /^An? (\w+) order can't (?:change|be changed)$/, vars: (m, t) => word("status", orderWord(t, m[1]!)) },
  { id: "lineWeightLocked", re: /^Line (\d+) is on a released press plan; its weight can't change now$/, vars: (m) => ({ n: m[1]! }) },
  { id: "releasedPlan", key: "orders.edit.releasedPlan", re: /^Line ([\d, ]+) is on a released press plan; its kg, pieces, length and section can't change now$/, vars: (m) => ({ lines: m[1]! }) },
  {
    id: "belowDispatched",
    key: "orders.edit.belowDispatched",
    re: /^([\d.,]+) kg is already dispatched on line (\d+), more than the new ([\d.,]+) kg$/,
    vars: (m) => ({ dispatched: m[1]!, line: m[2]!, kg: m[3]! }),
  },
  { id: "listedTwice", re: /^A bundle is listed twice$/ },
  { id: "pickOpenOrder", re: new RegExp(`^${S} is (\\w+); pick an open order$`), vars: (m, t) => withWord({ order: m[1]! }, orderWord(t, m[2]!)) },
  { id: "pendingRealloc", re: new RegExp(`^${S} is waiting on a reallocation approval$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "alreadyOnLine", re: new RegExp(`^${S} is already on ${S} line (\\d+)$`), vars: (m) => ({ serial: m[1]!, order: m[2]!, n: m[3]! }) },
  { id: "heldFor", re: new RegExp(`^${S} is (?:already )?held for ${S} line (\\d+) \\(.*\\)\\. Release (?:the hold|it) first\\.$`), vars: (m) => ({ serial: m[1]!, order: m[2]!, n: m[3]! }) },
  { id: "heldOther", re: new RegExp(`^${S} is already held for another order line\\. Release it first\\.$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "alreadyPlantStock", re: new RegExp(`^${S} is already plant stock$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "bundleDispatched", re: new RegExp(`^${S} is already dispatched$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "bundleVoid", re: new RegExp(`^${S} is void$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "onDispatchHeld", re: new RegExp(`^${S} is held on dispatch\\b.*$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "onDispatch", re: new RegExp(`^${S} is on dispatch (\\S*); take it off the dispatch first$`), vars: (m) => ({ serial: m[1]!, code: m[2]! }) },
  { id: "diffDie", re: new RegExp(`^${S} is a different die from that line$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "pickReason", re: /^Pick a reason from the list$/ },
  { id: "reasonNote", re: /^Write a note for this reason$/ },
  { id: "moveWhy", re: /^Say why the bundles move$/ },
  { id: "cutDiffers", re: /^The cut length differs for (.+)\. Pick a reason code to move them\.$/, vars: (m) => ({ serials: m[1]! }) },
  { id: "holdOrderClosed", re: new RegExp(`^${S} is (\\w+); hold stock for an open order$`), vars: (m, t) => withWord({ order: m[1]! }, orderWord(t, m[2]!)) },
  { id: "holdNotAvailable", re: new RegExp(`^${S} is \\w+; only bundles in the yard can be held$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "onOtherOrder", re: new RegExp(`^${S} is on .*; move it with Reallocate instead$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "notHeldFor", re: new RegExp(`^(.+) (?:is|are) not held for ${S} line (\\d+)$`), vars: (m) => ({ serials: m[1]!, order: m[2]!, n: m[3]! }) },
  { id: "savedAsBooking", re: /^A new order is saved as a booking\. Confirm it with Confirm once it is complete\.$/ },
  { id: "saveUsed", re: /^This save was already used for another order \((\S+)\)\. Reload the order screen and save again\.$/, vars: (m) => ({ code: m[1]! }) },
  {
    id: "editMoveStatus",
    re: /^An edit can't move the order from (\w+) to (\w+)\. Use Confirm, Close or Cancel\.$/,
    vars: (m, t) => {
      const from = orderWord(t, m[1]!);
      const to = orderWord(t, m[2]!);
      return from && to ? { from, to } : null;
    },
  },
  { id: "customerLocked", re: /^Bundles are linked to this order; the customer can't change$/ },
  { id: "lineTwice", re: /^Line (\d+) is listed twice$/, vars: (m) => ({ n: m[1]! }) },
  { id: "lineSectionLocked", re: /^Line (\d+) has bundles; its section can't change$/, vars: (m) => ({ n: m[1]! }) },
  { id: "lineHasWork", re: /^Line (\d+) has bundles or dispatches; change its kg instead of removing it$/, vars: (m) => ({ n: m[1]! }) },
  { id: "lineOnPlan", re: /^Line ([\d, ]+) is on a press plan; change its kg instead of removing it$/, vars: (m) => ({ n: m[1]! }) },
  { id: "enterPieces", re: /^Enter the pieces$/ },
  { id: "weightMore", re: /^Weight must be more than 0$/ },
  { id: "ratesOff", re: /^Rates on sales orders are turned off for this plant$/ },

  // --- press plans --------------------------------------------------------------------------
  { id: "planWindow", re: /^The plan window must end after it starts and be at most 24 hours$/ },
  { id: "thatPressRetired", re: /^That press line is retired$/ },
  { id: "addPressFirst", re: /^Add a press line first$/ },
  { id: "pickPress", re: /^Pick the press line for this plan$/ },
  { id: "noKg12", re: new RegExp(`^Line (\\d+) of ${S} has no kg/12ft; enter the kg$`), vars: (m) => ({ n: m[1]!, order: m[2]! }) },
  { id: "nothingLeftToPlan", re: new RegExp(`^Nothing is left to plan on ${S} line (\\d+)$`), vars: (m) => ({ order: m[1]!, n: m[2]! }) },
  {
    id: "askedMore",
    re: new RegExp(`^${S} line (\\d+): ([\\d.,]+) kg asked, only ([\\d.,]+) kg is left to plan$`),
    vars: (m) => ({ order: m[1]!, n: m[2]!, asked: m[3]!, left: m[4]! }),
  },
  { id: "addOneLine", re: /^Add at least one (?:order line|die and order line)$/ },
  { id: "trialNoLines", re: /^Only a production plan takes order lines$/ },
  { id: "dieTwice", re: /^A die is on the plan twice; put its lines under one die$/ },
  { id: "lineTwicePlan", re: /^An order line is on the plan twice$/ },
  { id: "maxLines", re: /^At most (\d+) order lines on a plan$/, vars: (m) => ({ max: m[1]! }) },
  { id: "confirmFirst", re: new RegExp(`^${S} is (\\w+); confirm it before planning$`), vars: (m, t) => withWord({ order: m[1]! }, orderWord(t, m[2]!)) },
  { id: "anotherDie", re: new RegExp(`^${S} line (\\d+) is another die$`), vars: (m) => ({ order: m[1]!, n: m[2]! }) },
  { id: "planDraftOnly", re: /^Only a draft plan can (?:be released|change) \(this plan is (\w+)\)$/, vars: (m, t) => word("status", planWord(t, m[1]!)) },
  { id: "cantGoToPress", re: new RegExp(`^${S} is (\\w+); it can't go to the press$`), vars: (m, t) => withWord({ order: m[1]! }, orderWord(t, m[2]!)) },
  { id: "planCancelStarted", re: /^A run of this plan has its die issued or has started; it can't be cancelled$/ },
  { id: "runsOpen", re: /^Some runs of this plan are not logged or voided yet$/ },
  { id: "planCantCancel", re: /^An? (\w+) plan can't be (?:cancelled|closed)$/, vars: (m, t) => word("status", planWord(t, m[1]!)) },
  { id: "nothingToChange", re: /^Nothing to change$/ },
  { id: "notOnPlan", re: /^That order line is not on this plan$/ },
  { id: "alreadyOnPlan", re: new RegExp(`^${S} line (\\d+) is already on this plan$`), vars: (m) => ({ order: m[1]!, n: m[2]! }) },
  { id: "planNeedsLine", re: /^A plan needs at least one order line; cancel the plan instead$/ },
  { id: "maxDies", re: /^At most (\d+) dies on a plan$/, vars: (m) => ({ max: m[1]! }) },
];

function word(name: string, w: string | null): TranslateVars | null {
  return w === null ? null : { [name]: w };
}

function withWord(base: Record<string, string>, w: string | null): TranslateVars | null {
  return w === null ? null : { ...base, status: w };
}

// ---------------------------------------------------------------------------
// Blockers: a refused confirm lists what the order still needs
// ---------------------------------------------------------------------------

const BLOCKERS_AFTER = [/^Fill these before confirming: (.+)$/, /^This order is (\w+); it still needs: (.+)$/] as const;

/** The blocker codes in a refused confirm or edit, and the status word when the server names one. */
export function blockersOf(message: string): { codes: string[]; status: string | null } | null {
  const a = BLOCKERS_AFTER[0].exec(message);
  if (a) return { codes: splitCodes(a[1]!), status: null };
  const b = BLOCKERS_AFTER[1].exec(message);
  if (b) return { codes: splitCodes(b[2]!), status: b[1]! };
  return null;
}

const splitCodes = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

export type Hit = { key: MessageKey; vars: TranslateVars };

/** The dictionary key and variables for one server sentence, or null when this build does not know it. */
export function mapSentence(message: string, t: Translate): Hit | null {
  for (const e of SERVER_REFUSALS) {
    const m = e.re.exec(message);
    if (!m) continue;
    const vars = e.vars ? e.vars(m, t) : {};
    if (vars === null) return null;
    return { key: keyOf(e), vars };
  }
  return null;
}

type TrpcLike = { message?: unknown; data?: { code?: unknown; meta?: { ownerName?: unknown } | null } | null };
const asTrpc = (error: unknown): TrpcLike => (error && typeof error === "object" ? (error as TrpcLike) : {});

const REFUSED = new Set(["BAD_REQUEST", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "PRECONDITION_FAILED"]);

/**
 * What a refused write says, as one or more lines (a refused confirm lists each thing the order still
 * needs). `other` words anything that is not a refusal the server wrote for a person (a server fault,
 * a lost answer): each app has its own wording for that.
 */
export function refusalLines(error: unknown, t: Translate, other: (error: unknown) => string, blockerText?: (code: string) => string): string[] {
  const e = asTrpc(error);
  const code = typeof e.data?.code === "string" ? e.data.code : undefined;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === undefined) return [t("errors.network")];
  if (code === "UNAUTHORIZED") return [t("errors.sessionExpired")];

  const owner = e.data?.meta?.ownerName;
  if (code === "FORBIDDEN" && typeof owner === "string" && owner) return [t("refusal.owned", { name: owner })];

  if (REFUSED.has(code) && message && !message.trimStart().startsWith("[") && !message.trimStart().startsWith("{")) {
    const blockers = blockersOf(message);
    if (blockers && blockers.codes.length > 0 && blockerText) {
      const head = blockers.status ? orderWord(t, blockers.status) : null;
      const lines = blockers.codes.map(blockerText);
      return blockers.status ? (head ? [t("refusal.stillNeeds", { status: head }), ...lines] : lines) : lines;
    }
    const hit = mapSentence(message, t);
    if (hit) return [t(hit.key, hit.vars)];
    if (code === "FORBIDDEN") return [t("errors.forbidden")];
    if (code === "CONFLICT") return [t("errors.conflict")];
    if (code === "NOT_FOUND") return [t("errors.notFound")];
    return [t("refusal.unknown")];
  }
  if (code === "FORBIDDEN") return [t("errors.forbidden")];
  if (code === "CONFLICT") return [t("errors.conflict")];
  if (code === "NOT_FOUND") return [t("errors.notFound")];
  if (code === "BAD_REQUEST") return [t("refusal.unknown")];
  return [other(error)];
}
