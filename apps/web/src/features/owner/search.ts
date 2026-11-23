/** Search of `/owner`: the production day shown (`?day=YYYY-MM-DD`); left out it is the server's default (yesterday). Plain function, no zod, so the route entry chunk stays small. */
export type OwnerSearch = { day?: string };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DAY.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

export function parseOwnerSearch(raw: Record<string, unknown>): OwnerSearch {
  return isDay(raw.day) ? { day: raw.day } : {};
}
