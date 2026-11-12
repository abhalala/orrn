import { fyEnd, fyLabel, fyOfIso, type IngestTarget } from "@orrn/ingest";

import type { Words } from "./model";
import type { CandidateDetail, PeriodGuess } from "./types";

/**
 * The year line (work order 3.3, M8). One line inside the decision bar, only for orders and bundles or when a
 * `period_needed` question is open. It says which year orrn guessed and from what, offers the last five financial
 * years, and is asked once: saving applies to the whole file (`actions.confirmPeriod` takes the artifact), so every
 * import of that file then shows only the saved line.
 */

export type YearOption = { value: string; label: string };

/** Today as an ISO day in the plant's zone is the screen's job; this reads a plain `YYYY-MM-DD`. */
function todayIso(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

/** The financial year (April to March) that a day is in, as "2025-26". */
export function fyOfToday(today: string): string {
  return fyOfIso(today) ?? fyLabel(Number(today.slice(0, 4)));
}

/** The last `count` financial years, newest first, with the guess added when it is older than that. */
export function financialYears(today: string, guess: string | null, count = 5): YearOption[] {
  const [y = "0", m = "1"] = today.split("-");
  const startYear = Number(m) >= 4 ? Number(y) : Number(y) - 1;
  const years: string[] = [];
  for (let i = 0; i < count; i += 1) years.push(fyLabel(startYear - i));
  if (guess && !years.includes(guess)) years.push(guess);
  return years.map((value) => ({ value, label: value }));
}

/** An as-on date to start from: the guess's own, else the end of the year, but never a day that has not come. */
export function defaultAsOf(fy: string | null, guessAsOf: string | null, today: string): string {
  if (guessAsOf) return guessAsOf;
  if (!fy) return "";
  const end = fyEnd(fy);
  return end && end <= today ? end : today;
}

export type YearLine =
  | { show: false }
  | {
      show: true;
      mode: "ask";
      /** "Which financial year is this file from?" */
      ask: Words;
      /** "orrn guessed 2025-26 from the file name." or "orrn found nothing in the file to tell the year." */
      guess: Words;
      /** Why orrn needs it, for orders and bundles. */
      why: Words | null;
      options: YearOption[];
      /** The guess, preselected. Empty when orrn found nothing: the select starts at "Choose". */
      fy: string;
      asOf: string;
      save: Words;
    }
  | { show: true; mode: "saved"; saved: Words; change: Words };

/** Does this import need the year line? Orders and bundles, or any import with a `period_needed` question. */
export function needsYearLine(candidate: Pick<CandidateDetail, "target" | "questions">): boolean {
  if (candidate.target === "orders" || candidate.target === "bundles") return true;
  return candidate.questions.some((q) => q.code === "period_needed");
}

/** The source orrn read the year from: the first one that gave a year (a legacy-code hint gives none). */
export function guessSource(period: PeriodGuess | null): string | null {
  if (!period || !period.fy) return null;
  const hit = period.sources.find((s) => s.kind !== "legacy_code" && ["title", "file_name", "sheet_name", "date_column", "bundle_no"].includes(s.kind));
  return hit ? hit.kind : null;
}

export function yearLine(
  candidate: Pick<CandidateDetail, "target" | "questions" | "period" | "periodConfirmed">,
  /** Writes an ISO day the plant's way (`plant.day`). */
  day: (iso: string) => string,
  now?: Date,
): YearLine {
  if (!needsYearLine(candidate)) return { show: false };
  const confirmed = candidate.periodConfirmed;
  if (confirmed && (confirmed.fy || confirmed.asOf)) {
    const date = confirmed.asOf ? day(confirmed.asOf) : "";
    const saved: Words = confirmed.fy
      ? { key: "ingest.period.done", vars: { fy: confirmed.fy, date } }
      : { key: "ingest.period.doneNoYear", vars: { date } };
    return { show: true, mode: "saved", saved, change: { key: "ingest.period.change" } };
  }
  const period = candidate.period;
  const fy = period?.fy ?? null;
  const source = guessSource(period);
  const guess: Words = fy && source
    ? { key: "ingest.period.guess", vars: { fy }, varKeys: { source: `ingest.period.source.${source}` } }
    : { key: "ingest.period.noGuess" };
  const today = todayIso(now);
  return {
    show: true,
    mode: "ask",
    ask: { key: "ingest.period.ask" },
    guess,
    why:
      candidate.target === "orders" ? { key: "ingest.period.whyOrders" } : candidate.target === "bundles" ? { key: "ingest.period.whyBundles" } : null,
    options: financialYears(today, fy),
    fy: fy ?? "",
    asOf: defaultAsOf(fy, period?.asOf ?? null, today),
    save: { key: "ingest.period.save" },
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `31/03/2026` (also 31-3-2026 or 31.03.2026) as `2026-03-31`, or null when it is not a real day. A plant in India writes the day first. */
export function parseDay(text: string): string | null {
  const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `2026-03-31` as `31/03/2026`. Anything that is not an ISO day comes back as it is (what the person typed). */
export function formatDay(value: string): string {
  return ISO_DAY.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;
}

/** A save that would fail on the server (the date outside the year, or a field left empty), said before it is sent. */
export function yearProblems(input: { fy: string; asOf: string }): { fy?: Words; asOf?: Words } {
  const out: { fy?: Words; asOf?: Words } = {};
  if (!input.fy) out.fy = { key: "common.required" };
  if (!input.asOf) out.asOf = { key: "common.required" };
  // Something typed that is not a day: say how to write it, not "required".
  else if (!ISO_DAY.test(input.asOf)) out.asOf = { key: "ingest.period.badDate" };
  else if (input.fy && fyOfIso(input.asOf) !== input.fy) out.asOf = { key: "ingest.period.mismatch", vars: { fy: input.fy } };
  return out;
}

/** The year line of a whole file (the file screen): shown once, only when the file has orders or bundles. */
export function fileYearTargets(blocks: readonly { candidates: readonly { target: IngestTarget | null }[] }[]): boolean {
  return blocks.some((b) => b.candidates.some((c) => c.target === "orders" || c.target === "bundles"));
}
