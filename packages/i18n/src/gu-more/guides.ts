import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/** Gujarati, W4-GU (guides). Needs a native-speaker review: .fp-build/reports/gu-review-list-web.md. */
export const guGuides = {
  guides: {
    title: "ગાઇડ",
    subtitle: "orrn ના દરેક કામ માટે સ્ટેપ બાય સ્ટેપ મદદ.",
    howTo: "કેવી રીતે કરવું",
    when: "ક્યારે વાપરવી",
    steps: "સ્ટેપ",
    problems: "કંઈ ગડબડ થાય તો",
    step: "સ્ટેપ {n}",
    forRoles: "કોના માટે: {roles}",
    open: "ગાઇડ ખોલો",
    all: "બધી ગાઇડ",
    empty: "તમારા રોલ માટે હજી કોઈ ગાઇડ નથી.",
    related: "જોડાયેલી સ્ક્રીન",
    platformRole: "orrn સપોર્ટ સ્ટાફ",
    notFoundTitle: "આ ગાઇડ અમારી પાસે નથી",
    notFoundBody: "લિંક જૂની કે ખોટી હોઈ શકે. યાદીમાંથી કોઈ ગાઇડ પસંદ કરો.",
  },
} as const satisfies DeepPartial<Messages>;
