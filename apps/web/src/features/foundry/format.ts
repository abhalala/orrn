/** Dates and clock times on the plant clock for the foundry lists. */
export function dayText(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", numberingSystem: "latn" }).format(new Date(ms));
}

export function clockText(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}
