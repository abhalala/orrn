/** A `buddy_draft` row as the bubble and Settings > Buddy show it (design 2026-11-18, §4.4, §13). */
import type { BuddyDraftStatus } from "@orrn/db/schema";

import { now } from "../clock";
import { describePath } from "./descriptions";
import { draftLink } from "./links";
import type { BuddyDraftLine, BuddyDraftView } from "./views";

export type DraftRow = {
  id: string;
  path: string;
  inputJson: unknown;
  status: BuddyDraftStatus;
  createdAt: Date;
  expiresAt: Date;
  resultJson: unknown;
  failure: string | null;
};

const SPLIT = /(?<=[a-z0-9])(?=[A-Z])/;
const MAX_VALUE = 200;
const MAX_LINES = 30;

function label(key: string): string {
  const words = key.split(SPLIT).join(" ").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function value(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}...` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const text = JSON.stringify(v) ?? "";
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}...` : text;
}

/** The input as label/value lines, in the order the model sent it. A non-object input is one line. */
export function draftLines(input: unknown): BuddyDraftLine[] {
  if (input === undefined || input === null) return [];
  if (typeof input !== "object" || Array.isArray(input)) return [{ label: "Input", value: value(input) }];
  return Object.entries(input as Record<string, unknown>)
    .slice(0, MAX_LINES)
    .map(([k, v]) => ({ label: label(k), value: value(v) }));
}

export function draftView(row: DraftRow, at: Date = now()): BuddyDraftView {
  const lapsed = row.status === "pending" && row.expiresAt.getTime() <= at.getTime();
  return {
    id: row.id,
    path: row.path,
    title: describePath(row.path),
    lines: draftLines(row.inputJson),
    status: lapsed ? "expired" : row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    result: row.resultJson ?? null,
    failure: row.failure,
    link: draftLink(row.path, row.inputJson),
  };
}
