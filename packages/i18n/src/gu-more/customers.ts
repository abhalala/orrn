import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/** Gujarati, W4-GU (customers). Needs a native-speaker review: .fp-build/reports/gu-review-list-web.md. */
export const guCustomers = {
  customers: {
    search: "નામ, ફોન કે GSTIN શોધો",
    searchLabel: "ગ્રાહક શોધો",
    empty: "હજી કોઈ ગ્રાહક નથી.",
    period: {
      label: "સમય",
      month: "આ મહિને",
      quarter: "આ ત્રિમાસિકમાં",
      fy: "આ વર્ષે",
      range: "{from} થી {to}",
    },
    form: {
      notes: "નોંધ",
      billingAddress: "બિલિંગનું સરનામું",
      shippingAddress: "ડિલિવરીનું સરનામું",
    },
    detail: {
      gstin: "GSTIN {gstin}",
      lastToday: "છેલ્લો dispatch આજે",
      lastYesterday: "છેલ્લો dispatch ગઈકાલે",
      lastDaysAgo: "છેલ્લો dispatch {count} દિવસ પહેલાં",
      lastNever: "હજી કોઈ dispatch નથી",
      cadence: "દર ~{count} દિવસે",
      contact: "સંપર્ક",
      noContact: "હજી કોઈ ફોન કે ઇમેઇલ નથી.",
      noAddress: "હજી કોઈ સરનામું નથી.",
      sameAsBilling: "બિલિંગવાળું જ સરનામું",
      notFound: "આ ગ્રાહક મળ્યો નહીં કે ડિલીટ થઈ ગયો છે.",
      backToList: "ગ્રાહકોની યાદી પર પાછા",
      kpi: {
        kg: "Dispatch થયું",
        dispatches: "Dispatch",
        avgLoad: "સરેરાશ લોડ",
        perDispatch: "kg દર dispatch",
      },
      recent: {
        title: "હમણાંના dispatch",
      },
      openOrders: {
        title: "બાકી ઓર્ડર",
        ordered: "ઓર્ડર થયું",
        dispatched: "Dispatch થયું",
        baki: "બાકી",
        lines: "{count} લાઇન",
      },
    },
    noDispatches: "આ ગ્રાહકનો હજી કોઈ dispatch નથી.",
  },
} as const satisfies DeepPartial<Messages>;
