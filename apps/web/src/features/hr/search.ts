/** The `/hr/timesheet` search parameters: plain checks, no view code, so the route's entry chunk stays small. */
export type TimesheetSearch = { id?: string; month?: string };

const clean = (v: unknown): string | undefined => (typeof v === "string" && v.trim() && v.length <= 64 ? v.trim() : undefined);

export function timesheetSearch(raw: Record<string, unknown>): TimesheetSearch {
  const id = clean(raw.id);
  const month = typeof raw.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month) ? raw.month : undefined;
  return { ...(id ? { id } : {}), ...(month ? { month } : {}) };
}
