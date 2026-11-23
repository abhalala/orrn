/**
 * Refusals from the buying routers (routers/storeIndent.ts, storePo.ts, store.ts receive), matched on
 * the server's English and said in the person's language. Never show `error.message`.
 */
import type { MessageKey, Translate } from "@orrn/i18n";

import { storeErrorText } from "@/features/store/store-errors";

type Hit = { key: MessageKey; vars?: Record<string, string> };

const RULES: { re: RegExp; hit: (m: RegExpExecArray) => Hit }[] = [
  {
    re: /^Over the order: (\S+) line (\d+) takes at most ([\d.,]+) more (\S+)$/,
    hit: (m) => ({ key: "store2.errors.overReceipt", vars: { po: m[1]!, line: m[2]!, qty: m[3]!, unit: m[4]! } }),
  },
  { re: / line \d+ is for another item$/, hit: () => ({ key: "store2.errors.poWrongItem" }) },
  { re: /^(\S+) is not open for deliveries$/, hit: (m) => ({ key: "store2.errors.poNotOpen", vars: { po: m[1]! } }) },
  { re: /^Quantity times rate is too large/, hit: () => ({ key: "store2.errors.tooLarge" }) },
  { re: /^(Purchase order|Purchase order line|Indent|Vendor) not found$/, hit: () => ({ key: "store2.errors.notFound" }) },
  { re: / is not a confirmed vendor$/, hit: () => ({ key: "store2.errors.vendorNotConfirmed" }) },
  { re: /; only an approved indent becomes an order$/, hit: () => ({ key: "store2.errors.indentNotApproved" }) },
  { re: / is no longer approved; open it again$/, hit: () => ({ key: "store2.errors.indentChanged" }) },
  { re: /^(\S+) already has goods in; close it short instead$/, hit: (m) => ({ key: "store2.errors.poHasGoods", vars: { po: m[1]! } }) },
  { re: /^(\S+) is [a-z ]+; it cannot be [a-z]+$/, hit: (m) => ({ key: "store2.errors.wrongStatus", vars: { number: m[1]! } }) },
  { re: /^Add at least one item$/, hit: () => ({ key: "store2.errors.noLines" }) },
  { re: /^At most \d+ items on one /, hit: () => ({ key: "store2.errors.tooManyLines" }) },
  { re: /^The same item is on the (indent|order) twice$/, hit: () => ({ key: "store2.errors.sameItemTwice" }) },
  { re: / is not below its minimum$/, hit: () => ({ key: "store2.errors.notBelow" }) },
];

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "";
}

function codeOf(error: unknown): string | undefined {
  const data = (error as { data?: { code?: string } } | null)?.data;
  return data?.code;
}

/** The words for a buying refusal; store refusals (quantities, retired items) fall through to the store's own map. */
export function buyErrorText(t: Translate, error: unknown): string {
  const message = messageOf(error);
  for (const rule of RULES) {
    const m = rule.re.exec(message);
    if (m) {
      const hit = rule.hit(m);
      return t(hit.key, hit.vars);
    }
  }
  if (codeOf(error) === "FORBIDDEN") return t("store2.errors.forbidden");
  if (codeOf(error) === "NOT_FOUND") return t("store2.errors.notFound");
  return storeErrorText(t, error);
}
