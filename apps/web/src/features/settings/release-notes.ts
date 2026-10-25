import { formatDay } from "@/features/dispatch/format";

/**
 * FP-PF-14 About, "What changed": rows from `release.notes` (the server already keeps the last
 * eight native builds, newest first). Pure, so the shaping is unit-tested.
 */
export type ReleaseNote = {
  id: string;
  platform: string;
  channel: string;
  version: string;
  buildNumber: number | null;
  mandatory: boolean;
  notes: string | null;
  publishedAt: number;
};

export type ReleaseNoteRow = {
  id: string;
  platform: "android" | "ios" | "web";
  version: string;
  build: string;
  day: string;
  notes: string;
  mandatory: boolean;
};

const PLATFORMS = ["android", "ios", "web"] as const;

export function releaseNoteRows(items: readonly ReleaseNote[] | undefined, opts: { locale?: string; now?: Date } = {}): ReleaseNoteRow[] {
  return (items ?? [])
    .filter((r): r is ReleaseNote & { platform: ReleaseNoteRow["platform"] } => (PLATFORMS as readonly string[]).includes(r.platform))
    .filter((r) => (r.notes ?? "").trim() !== "")
    .map((r) => ({
      id: r.id,
      platform: r.platform,
      version: r.version,
      build: r.buildNumber == null ? "-" : String(r.buildNumber),
      day: formatDay(r.publishedAt, { locale: opts.locale, now: opts.now }) ?? "",
      notes: (r.notes ?? "").trim(),
      mandatory: r.mandatory,
    }));
}
