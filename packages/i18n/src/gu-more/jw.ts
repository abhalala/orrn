/**
 * Gujarati, XE parity lane JOBWORK: the nav and module names (gu floor namespaces `nav`, `settings`
 * reach these) and `jw.refusal` (a refused send or receive reaches the yard floor). The rest of `jw`
 * falls back to English. Needs a native-speaker review.
 */
export const guJw = {
  nav: {
    jobwork: "જોબ વર્ક",
    drawbench: "ડ્રો બેન્ચ",
    fabrication: "ફેબ્રિકેશન",
  },
  jw: {
    refusal: {
      bundleAtVendor: "બંડલ {serial} જોબ વર્ક માટે {step} પર બહાર છે",
      bundleInProcess: "બંડલ {serial} પ્રોસેસ સ્ટેપ {step} પર છે",
      bundleNotInStock: "બંડલ {serial} યાર્ડમાં નથી; ફક્ત યાર્ડનો સ્ટોક પ્રોસેસ સ્ટેપ પર જઈ શકે",
      bundleOnDispatch: "બંડલ {serial} ડિસ્પેચ પર છે; પહેલા તેને લોડ પરથી કાઢો",
      bundleOffLedger: "બંડલ {serial} હજી સ્ટોક લેજર પર નથી; પહેલા ઓપનિંગ બેલેન્સ લો",
      bundleTwice: "બંડલ {serial} બે વાર લખ્યું છે",
      vendorNeeded: "જોબ વર્ક વેન્ડર પસંદ કરો",
      vendorInactive: "વેન્ડર {code} ચાલુ નથી",
      vendorCodeTaken: "વેન્ડર કોડ {code} પહેલેથી વપરાયેલ છે",
      vendorHasStock: "વેન્ડર {code} પાસે હજી બંડલ બહાર છે; પહેલા તે પાછા લો",
      stepClosed: "સ્ટેપ {step} પહેલેથી બંધ છે",
      inputNotOnStep: "બંડલ {serial} {step} પર નથી",
      inputAlreadyBack: "બંડલ {serial} {step} પરથી પહેલેથી પાછું આવી ગયું છે",
      noOutput: "જે પાછું આવ્યું તે લખો: સારું વજન, રિજેક્ટ કે સ્ક્રેપ",
      negativeWeight: "વજન શૂન્યથી ઓછું ન હોઈ શકે",
      gainTooHigh: "મોકલ્યા કરતાં 100 માં 5 થી વધુ પાછું આવ્યું; વજન તપાસો",
      outputOverInput: "મોકલ્યા કરતાં વધુ પાછું આવ્યું; વજન તપાસો",
      cancelAfterReturn: "{step} માં વાપસી થઈ ચૂકી છે; તેને રદ ન કરી શકાય",
      noYard: "બંડલ જ્યાં પાછા આવશે તે યાર્ડ પસંદ કરો",
      processKindMismatch: "આ પ્રોસેસ આ પ્રકારના સ્ટેપની નથી",
      vendorLocation: "આ જગ્યા એક જોબ વર્ક વેન્ડરની છે; તેને વેન્ડર પર બદલો",
      codeAmbiguous: "{code} સાથે એકથી વધુ બંડલ મળે છે; પૂરો નંબર સ્કેન કરો",
      codeNotFound: "{code} નંબરનું કોઈ બંડલ નથી",
      noBundles: "ઓછામાં ઓછું એક બંડલ સ્કેન કરો",
      tooManyBundles: "એક સ્ટેપ પર વધુમાં વધુ {n} બંડલ જાય",
      rejectsLeaveOne: "બંડલ {serial} માં {pcs} પીસ છે; રિજેક્ટ પછી ઓછામાં ઓછો એક બચવો જોઈએ",
      outputSection: "દરેક નવા બંડલનો સેક્શન પસંદ કરો",
      consumedInput: "બંડલ {serial} {step} પર વપરાઈ ગયું; તે પાછું ન આવી શકે",
    },
  },
  plantSettings: {
    modules: {
      names: {
        jobwork: "જોબ વર્ક",
        drawbench: "ડ્રો બેન્ચ",
        fabrication: "ફેબ્રિકેશન",
      },
    },
  },
};
