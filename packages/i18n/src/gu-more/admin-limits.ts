import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/**
 * Gujarati for the Godseye Limits tab and the audit entries of the import portal release 2 (fix round 2026-11-20,
 * decision 14). `admin` and `audit` stay office namespaces that fall back to English elsewhere. Needs a native-speaker
 * review, like the other gu-more files. "Row" is લાઇન on every import screen.
 */
export const guAdminLimits = {
  admin: {
    limits: {
      intro: "આ પ્લાન્ટની મર્યાદાઓ. તમે બદલો નહીં ત્યાં સુધી દરેક મર્યાદા orrn ની ડિફૉલ્ટ પ્રમાણે ચાલે છે.",
      names: {
        dayModelCalls: "રોજ મોડેલ કૉલ",
        dayModelCostCents: "રોજ મોડેલ ખર્ચ",
        blockModelCalls: "દરેક ટેબલ પર મોડેલના પ્રયત્નો",
        visionPagesPerBatch: "એક વારમાં વંચાતા પેજ",
        filesPerUpload: "એક અપલોડમાં ફાઇલો",
        rawRowsPerFile: "દરેક ફાઇલમાં લાઇનો",
        openRowsPerPlant: "મર્જની રાહમાં લાઇનો",
        uploadFileMiB: "એક અપલોડમાં સૌથી મોટી ફાઇલ",
        vaultQuotaGiB: "આ પ્લાન્ટની ફાઇલ જગ્યા",
      },
      hints: {
        dayModelCalls: "એક પ્લાન્ટ દિવસમાં મોડેલ કેટલી વાર વાંચે. દિવસ ભારતના સમય પ્રમાણે મધરાતે શરૂ થાય છે.",
        dayModelCostCents: "એક પ્લાન્ટ દિવસમાં મોડેલ કેટલો ખર્ચ કરી શકે, અમેરિકી ડૉલરમાં.",
        blockModelCalls: "કોઈ વ્યક્તિ જુએ તે પહેલાં એક ટેબલ કે પેજના એક ભાગ પર કેટલા પ્રયત્નો થાય.",
        visionPagesPerBatch: "એક PDF કે ફોટોના કેટલા પેજ એક વારમાં વંચાય.",
        filesPerUpload: "એક વાર પસંદ કરવામાં કે મૂકવામાં કેટલી ફાઇલો લેવાય.",
        rawRowsPerFile: "આનાથી વધુ લાઇનોવાળી ફાઇલ લેવાતી નથી.",
        openRowsPerPlant: "ઇમ્પોર્ટની જે લાઇનો હજી મર્જ કે રદ થઈ નથી. આનાથી ઉપર નવી ફાઇલો અટકે છે.",
        uploadFileMiB: "આનાથી મોટી ફાઇલ ઉમેરતી વખતે લેવાતી નથી. MB માં.",
        vaultQuotaGiB: "આ પ્લાન્ટની રાખેલી મૂળ ફાઇલો, ચાલુ અપલોડ સહિત. આનાથી ઉપર જતી નવી ફાઇલ લેવાતી નથી. GB માં.",
      },
      defaultValue: "ડિફૉલ્ટ {value}",
      ceiling: "વધુમાં વધુ {max}",
      usesDefault: "ડિફૉલ્ટ પર છે",
      setHere: "આ પ્લાન્ટ માટે નક્કી",
      useDefault: "ડિફૉલ્ટ રાખો",
      invalid: "1 થી {max} સુધીની પૂર્ણ સંખ્યા લખો.",
      invalidMoney: "0.01 થી {max} સુધીની રકમ લખો.",
      costBuys: "રોજ ભરેલા પેજના લગભગ {count} ભાગ, દરેક ભાગ લગભગ 7 અમેરિકી સેન્ટનો.",
      callsBuy: "રોજ ભરેલા પેજના લગભગ {count} ભાગ. રોજ મોડેલ કૉલની મર્યાદા પહેલાં પૂરી થાય છે.",
      save: "મર્યાદાઓ સેવ કરો",
      saved: "મર્યાદાઓ સેવ થઈ",
      unsaved: "ફેરફાર સેવ થયા નથી",
    },
  },
  audit: {
    actions: {
      ingest__vision__start: "PDF કે ફોટો પેજ પ્રમાણે વંચાયો",
      ingest__vision__page: "મોડેલે પેજ વાંચ્યું",
      ingest__vision__bands: "વાંચવા માટે પેજને ભાગમાં કાપ્યું",
      ingest__vision__skip: "પેજ છોડ્યું",
      ingest__vision__type: "પેજ હાથથી ટાઇપ કર્યું",
      ingest__vision__check: "ટેબલ તેના પેજ સાથે મેળવ્યું",
      ingest__vision__fix: "પેજના ટેબલનું એક ખાનું સુધાર્યું",
      ingest__vision__batch: "આગળના પેજ વાંચવા માટે નક્કી કર્યા",
      ingest__vision__rest: "બાકીના પેજ વગર ફાઇલ પૂરી કરી",
      platform__company__limits__update: "orrn સપોર્ટે પ્લાન્ટની મર્યાદાઓ બદલી",
    },
  },
} as const satisfies DeepPartial<Messages>;
