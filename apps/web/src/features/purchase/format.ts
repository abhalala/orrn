/** Number and date text for purchase screens: kg from grams, % from basis points, book dates. */
const KG = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const PCT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Grams as kg the way the kanta slip reads: "12,450", "12,450.5". */
export function kgText(g: number): string {
  return KG.format(g / 1000);
}

/** Basis points as "0.5%". */
export function pctText(bp: number): string {
  return `${PCT.format(bp / 100)}%`;
}

/** Item names like "PATTA/ROTTER/HEATSINK": a zero-width space after each slash, so narrow cells wrap at a slash. */
export function slashBreaks(text: string): string {
  return text.replaceAll("/", "/​");
}
