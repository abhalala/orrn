/**
 * XE parity lane ADM in Hindi. Same shape as `en.ts`. Plant words stay as the rest of the dictionary
 * has them: die, bundle, Dispatch, सेक्शन, ऑर्डर.
 */
import { admFloorHi } from "./hi-floor";
import { admMastersHi } from "./hi-masters";

export const admHi = {
  pl: {
    packingMode: "पैकिंग",
    insurance: "ट्रांजिट बीमा",
    insuranceValue: "{policy}, {insurer}",
  },
  kinds: {
    department: "विभाग",
    designation: "पद",
    packing_mode: "पैकिंग के तरीके",
    die_category: "Die की श्रेणियां",
  },
  kindOne: {
    department: "विभाग",
    designation: "पद",
    packing_mode: "पैकिंग का तरीका",
    die_category: "Die की श्रेणी",
  },
  tooling: {
    bolster: "बोल्स्टर",
    backer: "बैकर",
    die_ring: "Die रिंग",
    container: "कंटेनर",
    liner: "लाइनर",
    other: "अन्य",
  },
  toolingStatus: {
    awaiting_inspection: "जांच बाकी",
    in_store: "स्टोर में",
    in_use: "इस्तेमाल में",
    at_maker: "मेकर के पास",
    failed: "जांच में फेल",
    retired: "रिटायर",
  },
  docKinds: {
    procedure: "प्रक्रिया",
    customer_spec: "ग्राहक स्पेक",
    drawing: "ड्रॉइंग",
    certificate: "सर्टिफिकेट",
    other: "अन्य",
  },
  inspection: {
    pass: "पास",
    fail: "फेल",
    none: "जांच नहीं हुई",
  },
  masters: admMastersHi,
  floor: admFloorHi,
};
