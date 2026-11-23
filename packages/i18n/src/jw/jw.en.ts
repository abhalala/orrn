import { jwWebEn } from "./jw.web.en";

/**
 * Process steps (XE parity lane JOBWORK): job work out to a vendor on a delivery challan, the in-house
 * finishing line, the draw bench and fabrication, on one engine. Plant words: "job work", "challan",
 * "sent", "came back", "loss", "rejects". `refusal.*` are the server's sentences
 * (lib/processRefusals.ts), matched in refusal-jobwork.ts. Screen words live in jw.web.en.ts.
 */
const jwBaseEn = {
  title: "Job work",
  kind: {
    jobwork: "Job work",
    finish: "Finishing line",
    draw: "Draw bench",
    fabricate: "Fabrication",
  },
  process: {
    anodise: "Anodise",
    powder_coat: "Powder coat",
    pvd: "PVD",
    machining: "Machining",
    other: "Other",
    draw: "Drawing",
    fabricate: "Fabrication",
  },
  op: {
    cut: "Cut to length",
    punch: "Punch",
    cnc: "CNC",
    drill: "Drill",
    other: "Other",
  },
  status: {
    open: "Out",
    partial: "Part back",
    done: "Back",
    cancelled: "Cancelled",
  },
  mode: {
    same: "Same bundles back",
    new: "New bundles",
  },
  finishState: {
    done: "Finished",
    at_vendor: "At the vendor",
    in_process: "On the line",
    pending: "Not finished yet",
  },
  ageBucket: {
    d0_7: "Up to 7 days",
    d8_15: "8 to 15 days",
    d16_30: "16 to 30 days",
    d30_plus: "Over 30 days",
  },
  refusal: {
    bundleAtVendor: "Bundle {serial} is out for job work on {step}",
    bundleInProcess: "Bundle {serial} is on process step {step}",
    bundleNotInStock: "Bundle {serial} is not in the yard; only yard stock can go on a process step",
    bundleOnDispatch: "Bundle {serial} is on a dispatch; take it off the load first",
    bundleOffLedger: "Bundle {serial} is not on the stock ledger yet; take the opening balance first",
    bundleTwice: "Bundle {serial} is listed twice",
    vendorNeeded: "Pick the job-work vendor",
    vendorInactive: "Vendor {code} is not active",
    vendorCodeTaken: "Vendor code {code} is already used",
    vendorHasStock: "Vendor {code} still has bundles out; receive them first",
    stepClosed: "Step {step} is already closed",
    inputNotOnStep: "Bundle {serial} is not on {step}",
    inputAlreadyBack: "Bundle {serial} is already back from {step}",
    noOutput: "Enter what came back: good weight, rejects or scrap",
    negativeWeight: "Weights cannot be below zero",
    gainTooHigh: "More came back than was sent, by over 5 in 100; check the weights",
    outputOverInput: "More came back than was sent; check the weights",
    cancelAfterReturn: "{step} has returns; it cannot be cancelled",
    noYard: "Pick the yard the bundles come back to",
    processKindMismatch: "That process does not belong to this kind of step",
    vendorLocation: "This place belongs to a job-work vendor; change it on the vendor",
    codeAmbiguous: "More than one bundle matches {code}; scan the full number",
    codeNotFound: "No bundle has the number {code}",
    noBundles: "Scan at least one bundle",
    tooManyBundles: "At most {n} bundles go on one step",
    rejectsLeaveOne: "Bundle {serial} has {pcs} pieces; rejects must leave at least one",
    outputSection: "Pick the section of each new bundle",
    consumedInput: "Bundle {serial} was used up on {step}; it cannot come back",
  },
};

export const jwEn = { ...jwBaseEn, ...jwWebEn };
