/**
 * The approvals inbox's reading of one request (spec P9 "approve"): its tone,
 * a one-line subject built from the request's meta, where it links to, and
 * whether this person may decide it. `approval.list` is readable by every
 * role, so meta is treated as data: ids only become links when they look like
 * ids.
 */
import type { StatusTone } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { canApprove, type ApprovalKind, type Me } from "@orrn/server/lib/permissions";

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** The approval kinds (mirror of `approvalKinds` in @orrn/db/schema/approval; the db package stays out of the web bundle). */
export const APPROVAL_KINDS = ["dc_note", "cast_close", "die_rerank", "dispatch_overdraw", "phantom_void"] as const satisfies readonly ApprovalKind[];

// Compile-time: every server kind is listed (a new kind fails check-types here until it is added).
type MissingKind = Exclude<ApprovalKind, (typeof APPROVAL_KINDS)[number]>;
const everyKindListed: [MissingKind] extends [never] ? true : never = true;
void everyKindListed;

export function isApprovalKind(v: unknown): v is ApprovalKind {
  return typeof v === "string" && (APPROVAL_KINDS as readonly string[]).includes(v);
}

export const APPROVAL_TONE: Record<ApprovalStatus, StatusTone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
};

export type ApprovalForView = {
  kind: ApprovalKind;
  status: ApprovalStatus;
  subjectId: string;
  requestedBy: string | null;
  meta: Record<string, unknown>;
};

export type ApprovalSubject = {
  kindKey: MessageKey;
  titleKey: MessageKey;
  vars: Record<string, string | number>;
  href: string | null;
};

/** uuid-ish or the seed's readable ids: letters, digits, dashes and underscores only. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const safeId = (v: unknown): string | null => (typeof v === "string" && SAFE_ID.test(v) ? v : null);

export function approvalSubject(row: ApprovalForView): ApprovalSubject {
  const kindKey = `approvals.kind.${row.kind}` as MessageKey;
  const m = row.meta ?? {};
  if (row.kind === "dc_note") {
    const lotId = safeId(m.lotId);
    return {
      kindKey,
      titleKey: m.type === "credit" ? "approvals.subject.dcCredit" : "approvals.subject.dcDebit",
      vars: { number: text(m.number), lot: text(m.lotNumber) },
      href: lotId ? `/purchase/${lotId}` : null,
    };
  }
  if (row.kind === "die_rerank") {
    const sectionId = safeId(m.sectionId);
    const to = typeof m.toRank === "number" ? m.toRank : text(m.toRank);
    const href = sectionId ? `/dies/${sectionId}` : null;
    // A copy with no tier yet gets "set tier", not "tier  to 1".
    if (typeof m.fromRank !== "number") {
      return { kindKey, titleKey: "approvals.subject.dieRerankNew", vars: { code: text(m.code), to }, href };
    }
    return { kindKey, titleKey: "approvals.subject.dieRerank", vars: { code: text(m.code), from: m.fromRank, to }, href };
  }
  return {
    kindKey,
    titleKey: "approvals.subject.generic",
    vars: { ref: text(m.code) || text(m.number) || text(m.serial) },
    href: null,
  };
}

/**
 * - decide: an approver role for this kind, not the requester, still pending
 * - own: the requester (nobody approves their own request, owner included)
 * - view: may read it but is not an approver for this kind
 * - decided: approved or rejected already
 */
export type DecideState = "decide" | "own" | "view" | "decided";

export function decideState(me: Me | null | undefined, row: ApprovalForView): DecideState {
  if (row.status !== "pending") return "decided";
  const role = me?.company?.role;
  if (!me || !role) return "view";
  if (row.requestedBy !== null && row.requestedBy === me.user.id) return "own";
  return canApprove(role, row.kind) ? "decide" : "view";
}
