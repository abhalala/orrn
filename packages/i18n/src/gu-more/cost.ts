import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/** Gujarati, costing (XE parity lane COST). Office only: the rest reads English. Needs a native-speaker review like the rest of gu. */
export const guCost = {
  cost: {
    title: "કોસ્ટિંગ",
    subtitle: "એક {massUnit} ની કિંમત, તેમાંથી કમાણી, પ્રેસ કેટલા ભરેલા છે અને આગળ શું આવે છે.",
    moduleOff: "આ પ્લાન્ટ માટે કોસ્ટિંગ ચાલુ નથી.",
    noAccess: "કોસ્ટિંગ માલિક, મેનેજર અને એકાઉન્ટ્સ માટે છે.",
    loadFailed: "લોડ થઈ શક્યું નહીં. ફરી પ્રયત્ન કરો.",
    from: "થી",
    to: "સુધી",
    total: "પ્લાન્ટ",
    tabs: {
      outlook: "આગળનું ચિત્ર",
      cost: "કિંમત",
      profit: "નફો",
      capacity: "પ્રેસ લોડ",
      forecast: "અંદાજ",
      dies: "Die",
      settings: "સેટિંગ",
    },
    stage: {
      metal: "ધાતુ",
      casting: "કાસ્ટિંગ",
      extrusion: "એક્સટ્રુઝન",
      ageing: "એજિંગ",
      finishing: "ફિનિશિંગ",
      packing: "પૅકિંગ",
    },
    method: {
      ma3: "છેલ્લા 3 મહિનાની સરેરાશ",
      ma3_seasonal: "છેલ્લા 3 મહિનાની સરેરાશ, મોસમ મુજબ સુધારેલી",
      too_little: "અંદાજ માટે ઓર્ડર ઓછા છે",
    },
    cost: {
      section: "સેક્શન",
      runs: "રન",
      good: "સારું {massUnit}",
      recovery: "રિકવરી",
      metal: "ધાતુ",
      total: "કુલ પ્રતિ {massUnit}",
      unknown: "ખબર નથી",
    },
    profit: {
      bySection: "સેક્શન",
      byCustomer: "ગ્રાહક",
      byMonth: "મહિનો",
      revenue: "વેચાણ",
      costCol: "કિંમત",
      margin: "માર્જિન",
      marginPct: "માર્જિન %",
      notAllowed: "તમને રેટ અને માર્જિન બતાવાતા નથી.",
    },
    capacity: {
      available: "ઉપલબ્ધ કલાક",
      booked: "બુક કલાક",
      load: "લોડ",
      over: "વધુ પડતું બુક",
      pressInactive: "{n} લાઇન છેલ્લે એવા પ્રેસ પર ચાલી જે હમણાં બંધ છે. તેમનું કામ ઉપર ગણ્યું નથી.",
    },
    dies: {
      attention: "ધ્યાન જોઈએ",
      all: "બધી copy",
      state: { due: "સમય થયો", soon: "જલ્દી", ok: "હજુ નહીં", unknown: "ઇતિહાસ ઓછો છે" },
    },
    settings: {
      title: "કોસ્ટિંગ સેટિંગ",
      save: "સેટિંગ સેવ કરો",
      saved: "સેવ થયું",
    },
    order: {
      title: "કિંમત અને માર્જિન",
      low: "ઓછું માર્જિન",
    },
  },
} satisfies DeepPartial<Messages>;
