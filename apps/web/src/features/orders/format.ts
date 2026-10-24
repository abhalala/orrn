/**
 * Number text for the orders screens. Every figure is the server's (grams, pieces, milli kg/12ft);
 * this file only writes it down: three decimals for kg, Indian digit grouping, no arithmetic.
 */
const KG = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const PCS = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Grams as kg to the gram: "553.500", "1,280.000". */
export function orderKgText(grams: number): string {
  return KG.format(grams / 1000);
}

/** Whole pieces: "1,200". */
export function pcsText(pcs: number): string {
  return PCS.format(pcs);
}

/** A weight basis in milli kg per 12 ft as "12.300". */
export function milliText(milli: number): string {
  return (milli / 1000).toFixed(3);
}

/** The kg field text for a gram figure the server returned ("553.500"), with no grouping so it can be typed over. */
export function kgFieldText(grams: number): string {
  return (grams / 1000).toFixed(3);
}

/** Paise as rupees per kg: "201.50". */
export function rateText(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** `Date` or ms as "24 Oct, 20:00" in the browser's zone (the plant's own clock). */
export function dayTimeText(at: Date | number | string, locale: string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    numberingSystem: "latn",
  }).format(d);
}
