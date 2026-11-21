/**
 * A `buddy_draft` row as the bubble and Settings > Buddy show it (design 2026-11-18, §4.4; fix round decision 9).
 *
 * The card shows exactly what Confirm runs, never cut:
 * - every input field, labelled in English from its key (the web maps known keys to the person's language);
 * - every entry of a composite draft's list (`items`);
 * - `candidateId` / `artifactId` as the sheet or file name when the row exists in this plant;
 * - not `expectSeq` (ingest drafts) or the request keys: Confirm fills them in (the draft id is the key).
 *
 * A draft the card cannot show in full is refused when it is made (`cardTooBig`). Pure: no database here, so the
 * MCP leg can build the same card to check its size.
 */
import type { BuddyDraftDecidedVia, BuddyDraftKind, BuddyDraftStatus } from "@orrn/db/schema";

import { now } from "../clock";
import { describePath } from "./descriptions";
import { draftLink } from "./links";
import type { BuddyDraftField, BuddyDraftItem, BuddyDraftView } from "./views";

export type DraftRow = {
  id: string;
  path: string;
  kind: BuddyDraftKind;
  inputJson: unknown;
  status: BuddyDraftStatus;
  createdAt: Date;
  expiresAt: Date;
  resultJson: unknown;
  failure: string | null;
  originPlatform: string | null;
  decidedVia: BuddyDraftDecidedVia | null;
};

/** The card's limits (decision 9): a draft over any of them is refused and the person goes to the screen. */
export const CARD_LIMITS = { fields: 40, valueChars: 2000, items: 200 } as const;
export const TOO_BIG_FOR_CARD = "Too big for a draft card. Send the person to the screen.";

/** Composite import drafts (decision 8): not procedure paths; each runs one allowed ingest procedure. */
export const IMPORT_ANSWERS_PATH = "import.answerQuestions";
export const IMPORT_DRY_RUN_PATH = "import.runDryRun";
export const KIND_TARGET: Record<Exclude<BuddyDraftKind, "procedure">, string> = {
  answers: "ingest.answer.set",
  dryRun: "ingest.dryRun.step",
};

/** The request keys Confirm always sets to the draft id (review S3). */
export const REQUEST_KEYS = ["clientRequestId", "clientMutationId"] as const;

/** Whether Confirm fills `expectSeq` from the candidate's current state (decision 8): ingest drafts on a candidate. */
export function fillsExpectSeq(path: string, input: unknown): boolean {
  return (
    path.startsWith("ingest.") &&
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).candidateId === "string"
  );
}

/** Keys the card never shows, because Confirm sets them itself. */
function hidden(path: string, input: unknown, key: string): boolean {
  if ((REQUEST_KEYS as readonly string[]).includes(key)) return true;
  return key === "expectSeq" && fillsExpectSeq(path, input);
}

const SPLIT = /(?<=[a-z0-9])(?=[A-Z])/;

export function fieldLabel(key: string): string {
  const words = key.split(SPLIT).join(" ").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as text, whole. Scalars plainly, a list of scalars joined, anything else as JSON. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))) {
    return v.map((x) => (x === null ? "" : String(x))).join(", ");
  }
  return JSON.stringify(v) ?? "";
}

/** id -> sheet or file name, for this plant's import rows (filled by the drafts list; empty on the MCP leg). */
export type DraftNames = ReadonlyMap<string, string>;
const NAMED_KEYS = new Set(["candidateId", "artifactId"]);

export type DraftCard = { fields: BuddyDraftField[]; items: BuddyDraftItem[] | null };

export function draftCard(path: string, kind: BuddyDraftKind, input: unknown, names: DraftNames = new Map()): DraftCard {
  if (input === undefined || input === null) return { fields: [], items: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { fields: [{ key: "input", label: "Input", value: valueText(input) }], items: null };
  }
  const fields: BuddyDraftField[] = [];
  let items: BuddyDraftItem[] | null = null;
  for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
    if (hidden(path, input, key)) continue;
    if (kind === "answers" && key === "answers" && Array.isArray(v)) {
      items = v.map((a) => {
        const { questionCode, subject, answer } = (a ?? {}) as { questionCode?: unknown; subject?: unknown; answer?: unknown };
        const code = valueText(questionCode);
        const about = valueText(subject);
        return { label: about ? `${code}: ${about}` : code, value: valueText(answer) };
      });
      continue;
    }
    const raw = valueText(v);
    fields.push({ key, label: fieldLabel(key), value: NAMED_KEYS.has(key) && typeof v === "string" ? (names.get(v) ?? raw) : raw });
  }
  return { fields, items };
}

/** True when the card could not show the draft in full (decision 9). */
export function cardTooBig(card: DraftCard, input: unknown): boolean {
  if (card.fields.length > CARD_LIMITS.fields) return true;
  if ((card.items?.length ?? 0) > CARD_LIMITS.items) return true;
  if (card.fields.some((f) => f.value.length > CARD_LIMITS.valueChars)) return true;
  if (card.items?.some((i) => i.label.length > CARD_LIMITS.valueChars || i.value.length > CARD_LIMITS.valueChars)) return true;
  // A top-level list longer than the card's item limit is too long to read, even when its text is short.
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const v of Object.values(input as Record<string, unknown>)) if (Array.isArray(v) && v.length > CARD_LIMITS.items) return true;
  }
  return false;
}

function originOf(platform: string | null): BuddyDraftView["origin"] {
  if (!platform) return null;
  return platform === "api_server" ? "chat" : "other";
}

function hasReport(result: unknown): boolean {
  return !!result && typeof result === "object" && "report" in (result as Record<string, unknown>);
}

export function draftView(row: DraftRow, names: DraftNames = new Map(), at: Date = now()): BuddyDraftView {
  const lapsed = row.status === "pending" && row.expiresAt.getTime() <= at.getTime();
  const card = draftCard(row.path, row.kind, row.inputJson, names);
  const candidateId = (row.inputJson as { candidateId?: unknown } | null)?.candidateId;
  const drive =
    row.kind === "dryRun" && row.status === "confirmed" && !hasReport(row.resultJson) && typeof candidateId === "string"
      ? { kind: "dryRun" as const, candidateId }
      : null;
  return {
    id: row.id,
    path: row.path,
    kind: row.kind,
    title: describePath(row.path),
    fields: card.fields,
    items: card.items,
    status: lapsed ? "expired" : row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    result: row.resultJson ?? null,
    failure: row.failure,
    link: draftLink(row.path, row.inputJson),
    origin: originOf(row.originPlatform),
    decidedVia: row.decidedVia,
    drive,
  };
}
