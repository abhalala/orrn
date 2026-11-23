import type { MessageKey } from "./en";
import { registerRefusals, type RefusalEntry } from "./refusal";

/**
 * XE parity lane QA: what a refused quality write or a quality gate says (the dispatch scan, pack, the
 * melt lock), as `qa.refusal.*` in en, hi and gu. Kept out of the shared table so the `/` entry does not
 * carry it: a quality, scan, pack or foundry screen imports this module and the table is registered on
 * load, the way `@orrn/i18n/refusal-ageing` is. `refusal-qa.test.ts` reads `lib/qaRefusals.ts` and fails
 * on any sentence left unmapped. "The code X is already used" and the station code rule share the ageing
 * sentence and key; "Not found" is the shared entry.
 */
const S = String.raw`(\S+)`;
const qa = (id: string): MessageKey => `qa.refusal.${id}` as MessageKey;

export const QA_REFUSALS: readonly RefusalEntry[] = [
  { id: "qaBundleNotInStock", key: qa("bundleNotInStock"), re: new RegExp(`^Bundle ${S} is not in stock; only stock can go on quality hold$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "qaAlreadyOnHold", key: qa("alreadyOnHold"), re: new RegExp(`^Bundle ${S} is already on quality hold$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "qaNotOnHold", key: qa("notOnHold"), re: new RegExp(`^Bundle ${S} is not on quality hold$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "qaBundleOnHold", key: qa("bundleOnHold"), re: new RegExp(`^Bundle ${S} is on quality hold$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "qaBundleOnLoad", key: qa("bundleOnLoad"), re: new RegExp(`^Bundle ${S} is held on a load; take it off the load first$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "qaLotWaiting", key: qa("lotWaiting"), re: new RegExp(`^${S} is waiting for inspection$`), vars: (m) => ({ lot: m[1]! }) },
  { id: "qaLotFailed", key: qa("lotFailed"), re: new RegExp(`^${S} failed inspection$`), vars: (m) => ({ lot: m[1]! }) },
  { id: "qaFirstPieceWaiting", key: qa("firstPieceWaiting"), re: new RegExp(`^The first piece of ${S} is not checked yet$`), vars: (m) => ({ run: m[1]! }) },
  { id: "qaFirstPieceFailed", key: qa("firstPieceFailed"), re: new RegExp(`^The first piece of ${S} failed; check a new piece first$`), vars: (m) => ({ run: m[1]! }) },
  { id: "qaKindSubject", key: qa("kindSubject"), re: /^This check cannot be recorded on that$/ },
  { id: "qaDimensionsNone", key: qa("dimensionsNone"), re: /^Enter at least one dimension$/ },
  { id: "qaDimensionsTooMany", key: qa("dimensionsTooMany"), re: /^Enter at most (\d+) dimensions$/, vars: (m) => ({ n: m[1]! }) },
  { id: "qaDimensionsBadValue", key: qa("dimensionsBadValue"), re: /^Each dimension needs a name, a nominal above zero and its tolerances$/ },
  { id: "qaDimensionsDuplicate", key: qa("dimensionsDuplicate"), re: /^A dimension is listed twice$/ },
  { id: "qaMechanicalNone", key: qa("mechanicalNone"), re: /^Enter at least one test value$/ },
  { id: "qaResultNeeded", key: qa("resultNeeded"), re: /^Pick pass or fail$/ },
  { id: "qaTemperCode", key: qa("temperCode"), re: /^Use a temper code such as T6, T5 or O, at most 8 letters and digits$/ },
  { id: "qaTemperTaken", key: qa("temperTaken"), re: new RegExp(`^Temper ${S} is already in the list$`), vars: (m) => ({ code: m[1]! }) },
  { id: "qaTemperYield", key: qa("temperYield"), re: /^The yield minimum cannot be above the tensile minimum$/ },
  { id: "qaPlanLimits", key: qa("planLimits"), re: /^A lower limit is above its upper limit$/ },
  { id: "qaPlanSavedMeanwhile", key: qa("planSavedMeanwhile"), re: /^Someone saved this quality plan just now; open it again and save$/ },
  { id: "qaStationTaken", key: "ageing.refusal.codeTaken" as MessageKey, re: new RegExp(`^The code ${S} is already used$`), vars: (m) => ({ code: m[1]! }) },
  { id: "qaStationCode", key: "ageing.refusal.codeInvalid" as MessageKey, re: /^Use letters, digits and dashes for the code, at most 16$/ },
  { id: "qaSubstituteSame", key: qa("substituteSame"), re: /^An alloy cannot be its own substitute$/ },
  { id: "qaSubstituteTaken", key: qa("substituteTaken"), re: new RegExp(`^${S} is already a substitute here$`), vars: (m) => ({ alloy: m[1]! }) },
  { id: "qaInstrumentTaken", key: qa("instrumentTaken"), re: new RegExp(`^Instrument ${S} is already in the list$`), vars: (m) => ({ code: m[1]! }) },
  { id: "qaInstrumentCode", key: qa("instrumentCode"), re: /^Use letters, digits and dashes for the instrument code, at most 24$/ },
  { id: "qaCalibrationFuture", key: qa("calibrationFuture"), re: /^The calibration date cannot be in the future$/ },
  { id: "qaCertificateKind", key: qa("certificateKind"), re: /^The certificate must be a PDF or a photo$/ },
];

registerRefusals(QA_REFUSALS);
