import { jwWebHi } from "./jw.web.hi";

/** Hindi for jw.en.ts (XE parity lane JOBWORK). Screen words live in jw.web.hi.ts. */
const jwBaseHi = {
  title: "जॉब वर्क",
  kind: {
    jobwork: "जॉब वर्क",
    finish: "फ़िनिशिंग लाइन",
    draw: "ड्रॉ बेंच",
    fabricate: "फ़ैब्रिकेशन",
  },
  process: {
    anodise: "एनोडाइज़",
    powder_coat: "पाउडर कोटिंग",
    pvd: "PVD",
    machining: "मशीनिंग",
    other: "अन्य",
    draw: "ड्रॉइंग",
    fabricate: "फ़ैब्रिकेशन",
  },
  op: {
    cut: "लंबाई में कटिंग",
    punch: "पंच",
    cnc: "CNC",
    drill: "ड्रिल",
    other: "अन्य",
  },
  status: {
    open: "बाहर",
    partial: "कुछ वापस",
    done: "वापस",
    cancelled: "रद्द",
  },
  mode: {
    same: "वही बंडल वापस",
    new: "नए बंडल",
  },
  finishState: {
    done: "फ़िनिश हो गया",
    at_vendor: "वेंडर के पास",
    in_process: "लाइन पर",
    pending: "अभी फ़िनिश नहीं",
  },
  ageBucket: {
    d0_7: "7 दिन तक",
    d8_15: "8 से 15 दिन",
    d16_30: "16 से 30 दिन",
    d30_plus: "30 दिन से ज़्यादा",
  },
  refusal: {
    bundleAtVendor: "बंडल {serial} जॉब वर्क के लिए {step} पर बाहर है",
    bundleInProcess: "बंडल {serial} प्रोसेस स्टेप {step} पर है",
    bundleNotInStock: "बंडल {serial} यार्ड में नहीं है; सिर्फ़ यार्ड का स्टॉक प्रोसेस स्टेप पर जा सकता है",
    bundleOnDispatch: "बंडल {serial} डिस्पैच पर है; पहले उसे लोड से हटाएँ",
    bundleOffLedger: "बंडल {serial} अभी स्टॉक लेजर पर नहीं है; पहले ओपनिंग बैलेंस लें",
    bundleTwice: "बंडल {serial} दो बार लिखा है",
    vendorNeeded: "जॉब वर्क वेंडर चुनें",
    vendorInactive: "वेंडर {code} चालू नहीं है",
    vendorCodeTaken: "वेंडर कोड {code} पहले से इस्तेमाल में है",
    vendorHasStock: "वेंडर {code} के पास अभी बंडल बाहर हैं; पहले उन्हें वापस लें",
    stepClosed: "स्टेप {step} पहले से बंद है",
    inputNotOnStep: "बंडल {serial} {step} पर नहीं है",
    inputAlreadyBack: "बंडल {serial} {step} से पहले ही वापस आ चुका है",
    noOutput: "जो वापस आया वह लिखें: अच्छा वज़न, रिजेक्ट या स्क्रैप",
    negativeWeight: "वज़न शून्य से कम नहीं हो सकता",
    gainTooHigh: "भेजे गए से 100 में 5 से ज़्यादा वापस आया; वज़न जाँचें",
    outputOverInput: "भेजे गए से ज़्यादा वापस आया; वज़न जाँचें",
    cancelAfterReturn: "{step} में वापसी हो चुकी है; इसे रद्द नहीं किया जा सकता",
    noYard: "वह यार्ड चुनें जहाँ बंडल वापस आएँगे",
    processKindMismatch: "यह प्रोसेस इस तरह के स्टेप का नहीं है",
    vendorLocation: "यह जगह एक जॉब वर्क वेंडर की है; इसे वेंडर पर बदलें",
    consumedInput: "बंडल {serial} {step} पर इस्तेमाल हो चुका है; यह वापस नहीं आ सकता",
  },
};

export const jwHi = { ...jwBaseHi, ...jwWebHi };
