/** Reference copy of the masters date helper before the plant formatter (units layer, slice b part 3). No screen imports it. */

/** "2026-10-04" as "4 Oct" (the plant's current year) or "31 Dec 2025". `today` is the company's day. */
export function formatDay(iso: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sameYear = today.slice(0, 4) === m[1];
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

