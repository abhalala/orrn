import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/**
 * Gujarati, Buddy (design 2026-11-18 §4.5). Needs a native-speaker review like the rest of gu. "Buddy", "Hermes" and
 * "orrn" are names and stay in Latin. Lines marked "unsure" are the ones the writer was least sure of.
 */
export const guBuddy = {
  buddy: {
    title: "Buddy",
    open: "Buddy ખોલો",
    newChat: "નવી વાત",
    addFile: "ફાઇલ ઉમેરો",
    addFileHint: "ફાઇલો ઇમ્પોર્ટ પેજ પર મૂકાય છે. Buddy ને ફાઇલ ક્યારેય મળતી નથી.",
    empty: "સ્ટોક, ઓર્ડર કે ઇમ્પોર્ટ વિશે પૂછો. કોઈ ફેરફાર એક કાર્ડમાં આવે છે, અને તમે પાકું કરો દબાવો ત્યારે જ થાય છે.",
    you: "તમે",
    inputLabel: "Buddy ને સંદેશ",
    placeholder: "સંદેશ લખો",
    send: "મોકલો",
    sendHint: "Enter થી સંદેશ જાય છે. Shift અને Enter થી નવી લાઇન.",
    connecting: "જોડાઈ રહ્યું છે",
    writing: "Buddy લખી રહ્યો છે",
    offline: "Buddy અત્યારે બંધ છે. થોડી વાર પછી ફરી પ્રયત્ન કરો.",
    rateLimited: "અત્યારે ઘણા બધા સંદેશ થયા. થોડી મિનિટ રાહ જુઓ.",
    failed: "Buddy જવાબ ન આપી શક્યો.",
    // unsure: wording for an answer cut before the end
    cut: "જવાબ પૂરો થાય તે પહેલાં અટકી ગયો.",
    tool: "orrn જોયું: {path}",
    waiting: "તમારી રાહમાં",
    draft: {
      confirm: "પાકું કરો",
      reject: "નામંજૂર કરો",
      // unsure: "તપાસ પેજ" for the import review page
      review: "તપાસ પેજ ખોલો",
      loading: "ફેરફાર લોડ થાય છે",
      expires: "{time} સુધી",
      result: "પરિણામ: {result}",
      failedWhy: "આ ન થયું. {reason}",
      confirmFailed: "પાકું ન થયું. ફરી પ્રયત્ન કરો.",
      rejectFailed: "નામંજૂર ન થયું. ફરી પ્રયત્ન કરો.",
      status: {
        pending: "રાહમાં",
        confirmed: "પાકું થયું",
        rejected: "નામંજૂર",
        expired: "સમય પૂરો",
        failed: "ન થયું",
      },
    },
    settings: {
      intro: "Buddy દરેક orrn સ્ક્રીન પર એક ચેટ બારીમાં Hermes છે. Hermes તમારી જેમ orrn વાંચે છે અને ફેરફાર તૈયાર કરે છે. તમે પાકું કરો દબાવો ત્યારે જ ફેરફાર થાય છે.",
      notListed: "આ પ્લાન્ટ માટે Buddy સેટ નથી.",
      notAvailable: "આ orrn માં Buddy હજી ચાલુ નથી. orrn ટીમને પૂછો.",
      loadFailed: "Buddy લોડ ન થયું. કનેક્શન તપાસો અને ફરી પ્રયત્ન કરો.",
      connection: "Hermes",
      notConnected: "Hermes જોડાયેલ નથી.",
      connect: "Hermes જોડો",
      connectFailed: "Hermes ન જોડાયું. ફરી પ્રયત્ન કરો.",
      connectedOn: "{time} એ જોડાયું",
      lastUsed: "છેલ્લે {time}",
      neverUsed: "હજી વપરાયું નથી",
      endsOn: "{time} એ પૂરું",
      revoke: "Hermes દૂર કરો",
      revokeTitle: "Hermes દૂર કરવું છે?",
      revokeBody: "Hermes ની orrn સુધીની પહોંચ તરત બંધ થાય છે. જે ફેરફાર પાકું કરવાની રાહમાં છે તે નીચેની યાદીમાં રહે છે.",
      revoked: "Hermes દૂર થયું.",
      revokeFailed: "Hermes દૂર ન થયું. ફરી પ્રયત્ન કરો.",
      // unsure: "ચાવી" for the access key
      keyTitle: "Hermes માટે ચાવી",
      keyOnce: "આ ચાવી ફક્ત એક જ વાર દેખાય છે. તેને અત્યારે કૉપી કરો અને સાચવીને રાખો. orrn તેને ફરી બતાવી શકતું નથી.",
      keyLabel: "ચાવી",
      copy: "ચાવી કૉપી કરો",
      copied: "ચાવી કૉપી થઈ",
      copyFailed: "કૉપી ન થયું. ચાવી પસંદ કરીને હાથથી કૉપી કરો.",
      keyDone: "મેં કૉપી કરી લીધી",
      calls: "છેલ્લા 100 કૉલ",
      callsEmpty: "Hermes એ હજી orrn ને કૉલ કર્યો નથી.",
      callPath: "શું",
      callMs: "{ms} ms",
      platform: {
        api_server: "orrn ચેટ",
        telegram: "Telegram",
      },
      outcome: {
        ok: "થઈ ગયું",
        needs_confirm: "પાકું કરવાની રાહમાં",
        forbidden: "મંજૂરી નથી",
        not_found: "મળ્યું નહીં",
        invalid: "ખોટું ઇનપુટ",
        rate_limited: "ઘણા બધા કૉલ",
        error: "ભૂલ",
        // unsure: "ટૂંકું કરીને" for a result cut to the size limit
        truncated: "થઈ ગયું, ટૂંકું કરીને",
      },
      drafts: "Buddy ના ફેરફાર",
      draftsEmpty: "Buddy તરફથી હજી કોઈ ફેરફાર નથી.",
    },
  },
} as const satisfies DeepPartial<Messages>;
