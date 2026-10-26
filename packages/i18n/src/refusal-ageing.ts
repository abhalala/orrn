import type { MessageKey } from "./en";
import { registerRefusals, type RefusalEntry } from "./refusal";

/**
 * W3-AG-S (review I3): what a refused ageing write says (ovens, trolleys, recipes, the batch, pack's
 * trolley draw, dispatch of a bundle in ageing), as `ageing.refusal.*` in en, hi and gu. Kept out of the
 * shared table so the `/` entry does not carry its 61 sentences: an ageing screen imports this module
 * once (web route chunk, native screen) and the table is registered on load, after the shared one
 * (`mapSentence` reads both), the same way `@orrn/i18n/refusal-foundry` does. `refusal-ageing.test.ts`
 * reads `lib/ageingRefusals.ts` and fails on any sentence left unmapped or taken first by another entry.
 */
const S = String.raw`(\S+)`;

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
 * Each is anchored on its own ending; `refusal-ageing.test.ts` checks that no shared entry takes one first.
 */
export const AGEING_REFUSALS: readonly RefusalEntry[] = [
  { id: "ageingOvenNotActive", key: ag("ovenNotActive"), re: new RegExp(`^Oven ${S} is not in service$`), vars: (m) => ({ oven: m[1]! }) },
  { id: "ageingOvenBusy", key: ag("ovenBusy"), re: new RegExp(`^Oven ${S} already has a batch in it$`), vars: (m) => ({ oven: m[1]! }) },
  { id: "ageingOvenTooHot", key: ag("ovenTooHot"), re: new RegExp(`^Oven ${S} cannot run this recipe's temperature$`), vars: (m) => ({ oven: m[1]! }) },
  { id: "ageingTrolleyNotActive", key: ag("trolleyNotActive"), re: new RegExp(`^Trolley ${S} is not in service$`), vars: (m) => ({ code: m[1]! }) },
  { id: "ageingTrolleyBusy", key: ag("trolleyBusy"), re: new RegExp(`^Trolley ${S} is on ${S}; close or void that batch first$`), vars: (m) => ({ code: m[1]!, batch: m[2]! }) },
  { id: "ageingRecipeNotActive", key: ag("recipeNotActive"), re: /^Pick an active ageing recipe$/ },
  { id: "ageingRecipeMaxSoak", key: ag("recipeMaxSoak"), re: /^The over-age limit must be longer than the soak$/ },
  { id: "ageingRecipeHardnessMax", key: ag("recipeHardnessMax"), re: /^The hardness warning must be above the minimum$/ },
  { id: "ageingCodeTaken", key: ag("codeTaken"), re: new RegExp(`^The code ${S} is already used$`), vars: (m) => ({ code: m[1]! }) },
  { id: "ageingCodeInvalid", key: ag("codeInvalid"), re: /^Use letters, digits and dashes for the code, at most 16$/ },
  { id: "ageingRecipeActiveLocked", key: ag("recipeActiveLocked"), re: /^An active recipe's numbers cannot change; save a new recipe and archive this one$/ },
  { id: "ageingOvenInUse", key: ag("ovenInUse"), re: new RegExp(`^Oven ${S} has a batch in it; take it out before changing its status$`), vars: (m) => ({ oven: m[1]! }) },
  {
    id: "ageingTrolleyInUse",
    key: ag("trolleyInUse"),
    re: new RegExp(`^Trolley ${S} carries ${S}; it stays in service until that batch closes$`),
    vars: (m) => ({ code: m[1]!, batch: m[2]! }),
  },
  { id: "ageingReasonWrongKind", key: ag("reasonWrongKind"), re: /^Pick a reason from this list$/ },
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
  { id: "ageingSimulatorOff", key: ag("simulatorOff"), re: /^The oven simulator is off on this server$/ },
  { id: "ageingAlreadyHeld", key: ag("alreadyHeld"), re: /^This trolley line is already held$/ },
  { id: "ageingNotHeld", key: ag("notHeld"), re: /^This trolley line has no hold to clear; a failed test clears with a retest or an approval$/ },
  { id: "ageingHoldAfterPack", key: ag("holdAfterPack"), re: /^Pieces were packed from this trolley; hold the lines that are still full$/ },
  { id: "ageingVoidInOven", key: ag("voidInOven"), re: new RegExp(`^${S} is in the oven; take it out first$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingVoidAfterPack", key: ag("voidAfterPack"), re: new RegExp(`^Pieces were packed from ${S}; it cannot be voided$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingVoidReasonMissing", key: ag("voidReasonMissing"), re: /^Say why this batch is voided$/ },
  { id: "ageingVoidAfterRework", key: ag("voidAfterRework"), re: new RegExp(`^Pieces of ${S} were aged again or discarded; it cannot be voided$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingVoidReworkChanged", key: ag("voidReworkChanged"), re: new RegExp(`^${S} took more pieces or was split after the rework; it cannot be voided$`), vars: (m) => ({ batch: m[1]! }) },
  { id: "ageingNothingToRework", key: ag("nothingToRework"), re: /^No held pieces are left to age again$/ },
  { id: "ageingDiscardOver", key: ag("discardOver"), re: /^Only (\d+) pieces are left on this trolley line$/, vars: (m) => ({ n: m[1]! }) },
  { id: "ageingSplitOff", key: ag("splitOff"), re: /^Splitting lengths is off for this plant$/ },
  { id: "ageingSplitAfterPack", key: ag("splitAfterPack"), re: /^Pieces were packed from this trolley line; it cannot be split$/ },
  { id: "ageingSplitLength", key: ag("splitLength"), re: /^The cuts must add up to the loaded length$/ },
  { id: "ageingNotReleased", key: ag("notReleased"), re: /^This trolley line is not released; it is not on the pack list$/ },
  { id: "ageingDrawOver", key: ag("drawOver"), re: /^Only (\d+) pieces are left on this trolley line to pack$/, vars: (m) => ({ n: m[1]! }) },
  { id: "ageingCastMismatch", key: ag("castMismatch"), re: new RegExp(`^This trolley line is from cast ${S}; pick that cast for the bundle$`), vars: (m) => ({ cast: m[1]! }) },
  { id: "ageingRowRequired", key: ag("ageingRowRequired"), re: /^This plant packs aged metal from a trolley; pick the trolley line$/ },
  { id: "ageingRowVoid", key: ag("rowVoid"), re: /^This trolley line is void$/ },
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

registerRefusals(AGEING_REFUSALS);
