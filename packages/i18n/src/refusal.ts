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

/** Order matters: the specific sentences come before the general ones. */
export const SERVER_REFUSALS: readonly RefusalEntry[] = [
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
  { id: "maxDies", re: /^At most (\d+) dies on a plan$/, vars: (m) => ({ max: m[1]! }) },  // --- W2-FD-S: foundry (casts, melts, spectro, masters). Keys are foundry.refusal.* -----------------
  { id: "fd_notFound", key: "foundry.refusal.notFound", re: /^(?:Cast|Melt|Alloy|Furnace|Lot|Return stream|Store item) not found$/ },
  { id: "fd_streamExists", key: "foundry.refusal.streamExists", re: /^A return stream with that code or name exists$/ },
  { id: "fd_giveName", key: "foundry.refusal.giveName", re: /^Give a name$/ },
  { id: "fd_pickAlloy", key: "foundry.refusal.pickAlloy", re: /^Pick the alloy$/ },
  { id: "fd_alloyRetired", key: "foundry.refusal.alloyRetired", re: new RegExp(`^Alloy ${S} is retired$`), vars: (m) => ({ code: m[1]! }) },
  { id: "fd_alloyMismatch", key: "foundry.refusal.alloyMismatch", re: new RegExp(`^Alloy ${S} is not ${S}$`), vars: (m) => ({ code: m[1]!, other: m[2]! }) },
  { id: "fd_castClosed", key: "foundry.refusal.castClosed", re: new RegExp(`^${S} is (?:already )?closed$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_castWaiting", key: "foundry.refusal.castWaiting", re: new RegExp(`^${S} is waiting for its close-out approval$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_castChanged", key: "foundry.refusal.castChanged", re: new RegExp(`^${S} changed; open it again$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_castDraft", key: "foundry.refusal.castDraft", re: new RegExp(`^${S} has a melt that is not locked; lock or discard it first$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_castShort", key: "foundry.refusal.castShort", re: new RegExp(`^The press used ${S} kg more billets of ${S} than the store held; pick a reason$`), vars: (m) => ({ kg: m[1]!, cast: m[2]! }) },
  { id: "fd_castTail", key: "foundry.refusal.castTail", re: new RegExp(`^${S} kg of ${S} billets is not explained; pick a reason$`), vars: (m) => ({ kg: m[1]!, cast: m[2]! }) },
  { id: "fd_castClosing", key: "foundry.refusal.castClosing", re: new RegExp(`^${S} changed while you were closing it; check the close-out again$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_castHasMelts", key: "foundry.refusal.castHasMelts", re: new RegExp(`^${S} has melts; cancel or discard them first$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_tailReason", key: "foundry.refusal.tailReason", re: /^Pick why the billets do not add up$/ },
  { id: "fd_noteNeeded", key: "foundry.refusal.noteNeeded", re: /^Say what (?:happened|is wrong) in the note$/ },
  { id: "fd_dayOrder", key: "foundry.refusal.dayOrder", re: /^The end day is before the start day$/ },
  { id: "fd_timesOrder", key: "foundry.refusal.timesOrder", re: /^The [\w ]+ is before the [\w ]+$|^The melt times are out of order; check them$/ },
  { id: "fd_future", key: "foundry.refusal.future", re: /^The (?:casting end|reading time) is in the future$/ },
  { id: "fd_span", key: "foundry.refusal.span", re: /^Check the times: the melt runs over 3 days$/ },
  { id: "fd_preheatEarly", key: "foundry.refusal.preheatEarly", re: new RegExp(`^The preheat start is more than 7 days before ${S} was opened; check the date$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_castAlloyOther", key: "foundry.refusal.castAlloyOther", re: new RegExp(`^${S} is ${S}; open a new cast for ${S}$`), vars: (m) => ({ cast: m[1]!, alloy: m[2]!, other: m[3]! }) },
  { id: "fd_lotNotInStock", key: "foundry.refusal.lotNotInStock", re: /^(.+) is (?:not|no longer) in scrap stock$/, vars: (m) => ({ lot: m[1]! }) },
  { id: "fd_lotLeft", key: "foundry.refusal.lotLeft", re: new RegExp(`^Only ${S} kg left in ${S}$`), vars: (m) => ({ kg: m[1]!, lot: m[2]! }) },
  { id: "fd_lineTwice", key: "foundry.refusal.lineTwice", re: /^A (?:lot|return stream) is listed twice(?:; put its kg on one line| in the outputs)$/ },
  { id: "fd_storeRetired", key: "foundry.refusal.storeRetired", re: /^(.+) is retired in the store; reactivate it first \(cancelling the melt returns it\)$/, vars: (m) => ({ name: m[1]! }) },
  { id: "fd_storeLocRetired", key: "foundry.refusal.storeLocRetired", re: /^(.+) is retired; reactivate it first \(cancelling the melt returns (.+) there\)$/, vars: (m) => ({ place: m[1]!, name: m[2]! }) },
  { id: "fd_byproduct", key: "foundry.refusal.byproduct", re: /^(.+) is a by-product; it is not charged or returned as metal$/, vars: (m) => ({ name: m[1]! }) },
  { id: "fd_namedRetired", key: "foundry.refusal.namedRetired", re: /^(.+) (?:is|was) retired$/, vars: (m) => ({ name: m[1]! }) },
  { id: "fd_logsTogether", key: "foundry.refusal.logsTogether", re: /^Logs need pieces, length and kg together$/ },
  { id: "fd_chemClose", key: "foundry.refusal.chemClose", re: /^For each chemical, close must be open minus used$/ },
  { id: "fd_storeQty", key: "foundry.refusal.storeQty", re: /^A store item needs the quantity used$/ },
  { id: "fd_storeTwice", key: "foundry.refusal.storeTwice", re: /^A store item is listed twice$/ },
  { id: "fd_chemName", key: "foundry.refusal.chemName", re: /^Name the chemical, or pick it from the store$/ },
  { id: "fd_tryAgain", key: "foundry.refusal.tryAgain", re: /^(?:The melt did not save|The foundry data changed); try again$/ },
  { id: "fd_meltCancelled", key: "foundry.refusal.meltCancelled", re: /^This melt is (?:already )?cancelled$/ },
  { id: "fd_discardInstead", key: "foundry.refusal.discardInstead", re: /^This melt is not locked; discard the draft instead$/ },
  { id: "fd_billetsUsed", key: "foundry.refusal.billetsUsed", re: new RegExp(`^The press has already used billets of ${S}; this melt can no longer be (?:cancelled|corrected)$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "fd_meltChanged", key: "foundry.refusal.meltChanged", re: /^(?:The|This) melt changed; open it again$/ },
  { id: "fd_base64", key: "foundry.refusal.base64", re: /^The file is not valid base64$/ },
  { id: "fd_fileSize", key: "foundry.refusal.fileSize", re: /^The file is larger than 1 MB$/ },
  { id: "fd_maxValues", key: "foundry.refusal.maxValues", re: new RegExp(`^At most ${S} values$`), vars: (m) => ({ max: m[1]! }) },
  { id: "fd_fileOrValues", key: "foundry.refusal.fileOrValues", re: /^Attach the file or enter the values$/ },
  { id: "fd_oneElement", key: "foundry.refusal.oneElement", re: /^Enter at least one element$/ },
  { id: "fd_resultVoid", key: "foundry.refusal.resultVoid", re: /^This result is already void$/ },
  { id: "fd_spectroLocked", key: "foundry.refusal.spectroLocked", re: /^The melt is locked; its spectro stays as it is$/ },
  { id: "fd_elementTwice", key: "foundry.refusal.elementTwice", re: /^An element is listed twice$/ },
  { id: "fd_minAboveMax", key: "foundry.refusal.minAboveMax", re: /^A minimum is above its maximum$/ },
  { id: "fd_requestReused", key: "foundry.refusal.requestReused", re: /^That request id was already used for something else$/ },
  { id: "fd_otherCast", key: "foundry.refusal.otherCast", re: /^This melt belongs to another cast$/ },
  { id: "fd_lockedAsk", key: "foundry.refusal.lockedAsk", re: /^This melt is locked; ask for a correction to change it$/ },
  { id: "fd_notDraft", key: "foundry.refusal.notDraft", re: /^This melt is not a draft$|^Only a draft can be discarded$/ },
  { id: "fd_onlyLocked", key: "foundry.refusal.onlyLocked", re: /^Only a locked melt can be corrected$/ },
  { id: "fd_pickWrong", key: "foundry.refusal.pickWrong", re: /^Pick what is wrong with the melt$/ },
  { id: "fd_askFirst", key: "foundry.refusal.askFirst", re: /^Ask for a correction first; an approver has to agree$/ },
  { id: "fd_correctionWaiting", key: "foundry.refusal.correctionWaiting", re: /^A correction for this melt is already waiting for approval$/ },
  { id: "fd_correctionApproved", key: "foundry.refusal.correctionApproved", re: /^A correction for this melt is approved; correct it now$/ },
  { id: "fd_giveBundle", key: "foundry.refusal.giveBundle", re: /^Give the bundle$/ },
  { id: "fd_simulatorOff", key: "foundry.refusal.simulatorOff", re: /^The furnace simulator is off$/ },
  { id: "fd_maxDays", key: "foundry.refusal.maxDays", re: /^Pick at most 92 days$/ },
  { id: "fd_addStream", key: "foundry.refusal.addStream", re: /^Add the \S+ return stream first \(Masters → Return streams\)$/ },
  { id: "fd_streamReactivate", key: "foundry.refusal.streamReactivate", re: new RegExp(`^The \\S+ return stream \\((\\S+)\\) is retired; reactivate it first \\(Masters → Return streams\\)$`), vars: (m) => ({ code: m[1]! }) },
  { id: "fd_streamByproduct", key: "foundry.refusal.streamByproduct", re: new RegExp(`^The ${S} return stream must be a by-product stream to take \\S+$`), vars: (m) => ({ code: m[1]! }) },
  { id: "fd_alreadyLocked", key: "foundry.refusal.alreadyLocked", re: /^This melt is already locked$/ },
  { id: "fd_addInput", key: "foundry.refusal.addInput", re: /^Add what went into the furnace$/ },
  { id: "fd_addLogs", key: "foundry.refusal.addLogs", re: /^Add the logs that came out$/ },
  { id: "fd_chargingStart", key: "foundry.refusal.chargingStart", re: /^Write the charging start time$/ },
  { id: "fd_castingEnd", key: "foundry.refusal.castingEnd", re: /^Write the casting end time, after the charging start$/ },
  { id: "fd_overCapacity", key: "foundry.refusal.overCapacity", re: /^More metal than the furnace holds; check the kg$/ },
  { id: "fd_balanceReason", key: "foundry.refusal.balanceReason", re: /^The kg in and out do not match; say why in the balance note$/ },
  { id: "fd_spectroReason", key: "foundry.refusal.spectroReason", re: /^Spectro has not passed; say why the melt is locked anyway$/ },
  { id: "fd_alloyReason", key: "foundry.refusal.alloyReason", re: /^This melt's alloy is not the cast's; say why$/ },
  { id: "fd_lineTooLarge", key: "foundry.refusal.lineTooLarge", re: /^A line is above 100 t; check the kg$/ },
  { id: "fd_spectroOver", key: "foundry.refusal.spectroOver", re: /^The eight elements add up to more than 100 %$/ },
  { id: "fd_spectroPpm", key: "foundry.refusal.spectroPpm", re: /^Spectro values must be whole ppm from 0 to 1,000,000$/ },
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
