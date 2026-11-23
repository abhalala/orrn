import type { MessageKey } from "./en";
import { registerRefusals, type RefusalEntry } from "./refusal";

/**
 * XE parity lane JOBWORK: what a refused process-step write says (job work out and back, the finishing
 * line, the draw bench, fabrication) and the process gate in dispatch, stock move, bundle void and the
 * ageing load, as `jw.refusal.*` in en, hi and gu. Its own module, registered on load like
 * `@orrn/i18n/refusal-ageing`: a job-work screen, the dispatch builder and the stock screen import it.
 * `refusal-jobwork.test.ts` reads `lib/processRefusals.ts` and fails on any sentence left unmapped.
 */
const S = String.raw`(\S+)`;
const jw = (id: string): MessageKey => `jw.refusal.${id}` as MessageKey;

export const JOBWORK_REFUSALS: readonly RefusalEntry[] = [
  { id: "jwBundleAtVendor", key: jw("bundleAtVendor"), re: new RegExp(`^Bundle ${S} is out for job work on ${S}$`), vars: (m) => ({ serial: m[1]!, step: m[2]! }) },
  { id: "jwBundleInProcess", key: jw("bundleInProcess"), re: new RegExp(`^Bundle ${S} is on process step ${S}$`), vars: (m) => ({ serial: m[1]!, step: m[2]! }) },
  {
    id: "jwBundleNotInStock",
    key: jw("bundleNotInStock"),
    re: new RegExp(`^Bundle ${S} is not in the yard; only yard stock can go on a process step$`),
    vars: (m) => ({ serial: m[1]! }),
  },
  { id: "jwBundleOnDispatch", key: jw("bundleOnDispatch"), re: new RegExp(`^Bundle ${S} is on a dispatch; take it off the load first$`), vars: (m) => ({ serial: m[1]! }) },
  {
    id: "jwBundleOffLedger",
    key: jw("bundleOffLedger"),
    re: new RegExp(`^Bundle ${S} is not on the stock ledger yet; take the opening balance first$`),
    vars: (m) => ({ serial: m[1]! }),
  },
  { id: "jwBundleTwice", key: jw("bundleTwice"), re: new RegExp(`^Bundle ${S} is listed twice$`), vars: (m) => ({ serial: m[1]! }) },
  { id: "jwVendorNeeded", key: jw("vendorNeeded"), re: /^Pick the job-work vendor$/ },
  { id: "jwVendorInactive", key: jw("vendorInactive"), re: new RegExp(`^Vendor ${S} is not active$`), vars: (m) => ({ code: m[1]! }) },
  { id: "jwVendorCodeTaken", key: jw("vendorCodeTaken"), re: new RegExp(`^Vendor code ${S} is already used$`), vars: (m) => ({ code: m[1]! }) },
  { id: "jwVendorHasStock", key: jw("vendorHasStock"), re: new RegExp(`^Vendor ${S} still has bundles out; receive them first$`), vars: (m) => ({ code: m[1]! }) },
  { id: "jwStepClosed", key: jw("stepClosed"), re: new RegExp(`^Step ${S} is already closed$`), vars: (m) => ({ step: m[1]! }) },
  { id: "jwInputAlreadyBack", key: jw("inputAlreadyBack"), re: new RegExp(`^Bundle ${S} is already back from ${S}$`), vars: (m) => ({ serial: m[1]!, step: m[2]! }) },
  { id: "jwInputNotOnStep", key: jw("inputNotOnStep"), re: new RegExp(`^Bundle ${S} is not on ${S}$`), vars: (m) => ({ serial: m[1]!, step: m[2]! }) },
  { id: "jwNoOutput", key: jw("noOutput"), re: /^Enter what came back: good weight, rejects or scrap$/ },
  { id: "jwNegativeWeight", key: jw("negativeWeight"), re: /^Weights cannot be below zero$/ },
  { id: "jwGainTooHigh", key: jw("gainTooHigh"), re: /^More came back than was sent, by over 5 in 100; check the weights$/ },
  { id: "jwOutputOverInput", key: jw("outputOverInput"), re: /^More came back than was sent; check the weights$/ },
  { id: "jwCancelAfterReturn", key: jw("cancelAfterReturn"), re: new RegExp(`^${S} has returns; it cannot be cancelled$`), vars: (m) => ({ step: m[1]! }) },
  { id: "jwNoYard", key: jw("noYard"), re: /^Pick the yard the bundles come back to$/ },
  { id: "jwProcessKindMismatch", key: jw("processKindMismatch"), re: /^That process does not belong to this kind of step$/ },
  { id: "jwVendorLocation", key: jw("vendorLocation"), re: /^This place belongs to a job-work vendor; change it on the vendor$/ },
  { id: "jwCodeAmbiguous", key: jw("codeAmbiguous"), re: new RegExp(`^More than one bundle matches ${S}; scan the full number$`), vars: (m) => ({ code: m[1]! }) },
  { id: "jwCodeNotFound", key: jw("codeNotFound"), re: new RegExp(`^No bundle has the number ${S}$`), vars: (m) => ({ code: m[1]! }) },
  { id: "jwNoBundles", key: jw("noBundles"), re: /^Scan at least one bundle$/ },
  { id: "jwTooManyBundles", key: jw("tooManyBundles"), re: /^At most (\d+) bundles go on one step$/, vars: (m) => ({ n: m[1]! }) },
  {
    id: "jwRejectsLeaveOne",
    key: jw("rejectsLeaveOne"),
    re: new RegExp(`^Bundle ${S} has (\\d+) pieces; rejects must leave at least one$`),
    vars: (m) => ({ serial: m[1]!, pcs: m[2]! }),
  },
  { id: "jwOutputSection", key: jw("outputSection"), re: /^Pick the section of each new bundle$/ },
  { id: "jwConsumedInput", key: jw("consumedInput"), re: new RegExp(`^Bundle ${S} was used up on ${S}; it cannot come back$`), vars: (m) => ({ serial: m[1]!, step: m[2]! }) },
];

registerRefusals(JOBWORK_REFUSALS);
