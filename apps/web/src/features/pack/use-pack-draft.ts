import type { LengthUnit } from "@orrn/domain";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The packing session being entered on `/pack/new`, kept in `sessionStorage`
 * (key `orrn.packDraft`) so a reload, a dropped tab or a quick look at another
 * screen never loses typed bundles. Session storage is per tab, which matches
 * "one packer, one session"; it is cleared after a successful save or a
 * discard. The pure functions below hold all the logic; `usePackDraft` wires
 * them to React state.
 */

export const PACK_DRAFT_KEY = "orrn.packDraft";

/** bundle.createReceipt accepts at most 200 rows. */
export const MAX_BUNDLES = 200;

export type DraftBundle = {
  weightG: number;
  pieces: number;
  /** Only when this bundle's cut length differs from the session default. */
  lengthMm?: number;
  /** Only when this bundle's PO differs from the session PO. */
  po?: string;
  /** Where the weight came from. Left out = typed (the server's default). */
  weightSource?: "scale" | "manual";
  /** The steady scale grams on the screen when the weight was taken or typed over. */
  scaleReadingG?: number;
  /** Why the weight was typed while a scale is connected. */
  weightOverrideReason?: string;
};

/** Pieces rejected at pack (FP-PK-14): they leave the trolley or the pile and are not a bundle. */
export type DraftReject = {
  pcs: number;
  /** Weighed rejects post kg at plant scrap; left out when the pieces were not weighed. */
  weightG?: number;
  /** A `qc_reject` reason code. `other` needs a note. */
  reasonCode: string;
  note?: string;
};

export type PackStep = 0 | 1 | 2;

export type PackDraft = {
  v: 1;
  /** Guards against a draft from another company in the same tab (impersonation, switching). */
  companyId: string;
  /**
   * The person who typed it. At a shared station another person signing in
   * on the same tab must not see, continue or save it as theirs. Drafts from
   * before this field have none and still open.
   */
  userId?: string;
  step: PackStep;
  dieId: string | null;
  /**
   * Session defaults. `lengthMm` 0 = not entered yet. `locationId` is the yard
   * the bundles go to (required by the server once the company has yards).
   */
  defaults: PackDefaults;
  bundles: DraftBundle[];
  /** Rejects of this session (FP-PK-14). */
  rejects?: DraftReject[];
};

/**
 * Session-wide choices of the Source step. `dieInstanceId` is the die copy that made the bundles,
 * `castId` the cast they came from, `salesOrderLineId` the order line they are packed for (none =
 * plant stock), `showLogo` the label branding (default on) and `approvalId` an approved owner override.
 */
export type PackDefaults = {
  lengthMm: number;
  po?: string;
  locationId?: string;
  dieInstanceId?: string;
  castId?: string;
  salesOrderLineId?: string;
  showLogo?: boolean;
  approvalId?: string;
};

export function emptyDraft(companyId: string, userId?: string): PackDraft {
  return { v: 1, companyId, ...(userId ? { userId } : {}), step: 0, dieId: null, defaults: { lengthMm: 0 }, bundles: [] };
}

export function isDraftEmpty(d: PackDraft): boolean {
  return (
    d.dieId === null &&
    d.bundles.length === 0 &&
    (d.rejects?.length ?? 0) === 0 &&
    !(d.defaults.lengthMm > 0) &&
    !d.defaults.po
  );
}

const isPosInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

function isDraftBundle(b: unknown): b is DraftBundle {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  return (
    isPosInt(r.weightG) &&
    isPosInt(r.pieces) &&
    (r.lengthMm === undefined || isPosInt(r.lengthMm)) &&
    (r.po === undefined || typeof r.po === "string") &&
    (r.weightSource === undefined || r.weightSource === "scale" || r.weightSource === "manual") &&
    (r.scaleReadingG === undefined || isPosInt(r.scaleReadingG)) &&
    (r.weightOverrideReason === undefined || typeof r.weightOverrideReason === "string")
  );
}

const MAX_REJECTS = 50;

function isDraftReject(x: unknown): x is DraftReject {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    isPosInt(r.pcs) &&
    (r.weightG === undefined || isPosInt(r.weightG)) &&
    typeof r.reasonCode === "string" &&
    r.reasonCode !== "" &&
    (r.note === undefined || typeof r.note === "string")
  );
}

const optionalString = (v: unknown) => v === undefined || typeof v === "string";

function parseDraft(raw: string): PackDraft | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const defaults = d.defaults as Record<string, unknown> | undefined;
  if (
    d.v !== 1 ||
    typeof d.companyId !== "string" ||
    !(d.userId === undefined || typeof d.userId === "string") ||
    ![0, 1, 2].includes(d.step as number) ||
    !(d.dieId === null || typeof d.dieId === "string") ||
    !defaults ||
    typeof defaults !== "object" ||
    typeof defaults.lengthMm !== "number" ||
    !(defaults.lengthMm >= 0) ||
    !(defaults.po === undefined || typeof defaults.po === "string") ||
    !(defaults.locationId === undefined || typeof defaults.locationId === "string") ||
    !optionalString(defaults.dieInstanceId) ||
    !optionalString(defaults.castId) ||
    !optionalString(defaults.salesOrderLineId) ||
    !optionalString(defaults.approvalId) ||
    !(defaults.showLogo === undefined || typeof defaults.showLogo === "boolean") ||
    !Array.isArray(d.bundles) ||
    d.bundles.length > MAX_BUNDLES ||
    !d.bundles.every(isDraftBundle) ||
    !(d.rejects === undefined || (Array.isArray(d.rejects) && d.rejects.length <= MAX_REJECTS && d.rejects.every(isDraftReject)))
  ) {
    return null;
  }
  return data as PackDraft;
}

/**
 * The stored draft for this company and person, or null (none, corrupt,
 * another company, another person, or storage blocked).
 */
export function readDraft(storage: Storage | null, companyId: string, userId?: string): PackDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PACK_DRAFT_KEY);
    if (!raw) return null;
    const draft = parseDraft(raw);
    if (!draft || draft.companyId !== companyId) return null;
    return userId && draft.userId && draft.userId !== userId ? null : draft;
  } catch {
    return null;
  }
}

/**
 * The draft shown on the Pack list: keyed by company AND person, exactly like
 * the write, so a shared tab never offers someone else's bundles.
 */
export function readDraftFor(storage: Storage | null, companyId: string, userId: string): PackDraft | null {
  return readDraft(storage, companyId, userId);
}

/**
 * Stores the draft (an empty one is removed instead, unless the stored one
 * belongs to another person on this tab). Never throws: storage is a convenience.
 */
export function writeDraft(storage: Storage | null, draft: PackDraft): void {
  if (!storage) return;
  try {
    if (isDraftEmpty(draft)) {
      const raw = storage.getItem(PACK_DRAFT_KEY);
      const stored = raw ? parseDraft(raw) : null;
      const theirs = stored && stored.userId && draft.userId && stored.userId !== draft.userId;
      if (!theirs) storage.removeItem(PACK_DRAFT_KEY);
    } else storage.setItem(PACK_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private mode or quota: the draft still lives in memory for this visit.
  }
}

export function clearDraft(storage: Storage | null): void {
  try {
    storage?.removeItem(PACK_DRAFT_KEY);
  } catch {
    // Nothing stored that we can reach; nothing to clear.
  }
}

export function addBundle(d: PackDraft, b: DraftBundle): PackDraft {
  if (d.bundles.length >= MAX_BUNDLES) return d;
  return { ...d, bundles: [...d.bundles, b] };
}

export function replaceBundle(d: PackDraft, index: number, b: DraftBundle): PackDraft {
  if (index < 0 || index >= d.bundles.length) return d;
  return { ...d, bundles: d.bundles.map((old, i) => (i === index ? b : old)) };
}

export function removeBundle(d: PackDraft, index: number): PackDraft {
  if (index < 0 || index >= d.bundles.length) return d;
  return { ...d, bundles: d.bundles.filter((_, i) => i !== index) };
}

export function addReject(d: PackDraft, r: DraftReject): PackDraft {
  const rejects = d.rejects ?? [];
  if (rejects.length >= MAX_REJECTS) return d;
  return { ...d, rejects: [...rejects, r] };
}

export function removeReject(d: PackDraft, index: number): PackDraft {
  const rejects = d.rejects ?? [];
  if (index < 0 || index >= rejects.length) return d;
  const next = rejects.filter((_, i) => i !== index);
  const { rejects: _drop, ...rest } = d;
  return next.length > 0 ? { ...rest, rejects: next } : rest;
}

export type ReceiptRow = {
  quantity: number;
  weightG: number;
  lengthMm: number;
  poNumber: string | null;
  weightSource?: "scale" | "manual";
  scaleReadingG?: number;
  weightOverrideReason?: string;
};

export type ReceiptInput = {
  dieId: string;
  unit: string;
  purchaseOrderRef: string | null;
  /** The yard; left out for companies without yard locations. */
  locationId?: string;
  dieInstanceId?: string;
  castId?: string;
  salesOrderLineId?: string;
  showLogo?: boolean;
  approvalId?: string;
  rows: ReceiptRow[];
  rejects?: { pcs: number; weightG?: number; reasonCode: string; note?: string }[];
};

const cleanPo = (po: string | undefined) => {
  const v = (po ?? "").trim();
  return v === "" ? null : v;
};

/** The company's active yard ids; empty for a company without yard locations. */
export type YardContext = { yardIds: readonly string[] };

/**
 * The yard the session's bundles go to, or undefined when the company has no
 * yards (the server only asks for one once yards exist). A yard that is no
 * longer active counts as not chosen.
 */
function sessionYard(d: PackDraft, yards: YardContext | undefined): string | undefined {
  const id = d.defaults.locationId;
  if (!id) return undefined;
  if (!yards) return id;
  return yards.yardIds.includes(id) ? id : undefined;
}

/**
 * The `bundle.createReceipt` payload, or null while the die, the cut length
 * or every bundle is still missing. A row's `poNumber` is set only for an
 * override; otherwise the server falls back to the session PO. With `yards`
 * given, a yard the company no longer has is left out.
 */
export function toReceiptInput(d: PackDraft, unit: LengthUnit, yards?: YardContext): ReceiptInput | null {
  if (!d.dieId || !(d.defaults.lengthMm > 0) || d.bundles.length === 0) return null;
  const locationId = sessionYard(d, yards);
  const { dieInstanceId, castId, salesOrderLineId, showLogo, approvalId } = d.defaults;
  const rejects = d.rejects ?? [];
  return {
    dieId: d.dieId,
    unit,
    purchaseOrderRef: cleanPo(d.defaults.po),
    ...(locationId ? { locationId } : {}),
    ...(dieInstanceId ? { dieInstanceId } : {}),
    ...(castId ? { castId } : {}),
    ...(salesOrderLineId ? { salesOrderLineId } : {}),
    ...(showLogo === false ? { showLogo: false } : {}),
    ...(approvalId ? { approvalId } : {}),
    rows: d.bundles.map((b) => ({
      quantity: b.pieces,
      weightG: b.weightG,
      lengthMm: b.lengthMm ?? d.defaults.lengthMm,
      poNumber: b.po === undefined ? null : cleanPo(b.po),
      ...(b.weightSource ? { weightSource: b.weightSource } : {}),
      ...(b.scaleReadingG ? { scaleReadingG: b.scaleReadingG } : {}),
      ...(b.weightOverrideReason?.trim() ? { weightOverrideReason: b.weightOverrideReason.trim() } : {}),
    })),
    ...(rejects.length > 0
      ? {
          rejects: rejects.map((r) => ({
            pcs: r.pcs,
            ...(r.weightG ? { weightG: r.weightG } : {}),
            reasonCode: r.reasonCode,
            ...(r.note?.trim() ? { note: r.note.trim() } : {}),
          })),
        }
      : {}),
  };
}

/**
 * The step the draft can really be on: a reload never lands past a missing
 * die, cut length or (when the company has yards) an active yard, nor on
 * Review without a bundle.
 */
export function reachableStep(d: PackDraft, yards: YardContext): PackStep {
  if (!d.dieId || !(d.defaults.lengthMm > 0)) return 0;
  if (yards.yardIds.length > 0 && !sessionYard(d, yards)) return 0;
  if (d.step === 2 && d.bundles.length === 0) return 1;
  return d.step;
}

/** A draft from before drafts carried the packer becomes this person's on its next write. */
function owned(d: PackDraft | null, userId: string): PackDraft | null {
  return d && !d.userId ? { ...d, userId } : d;
}

/** `window.sessionStorage`, or null where reading it throws (blocked site data). */
function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * React state for the draft, mirrored into sessionStorage on every change.
 * `restored` is true when the screen opened onto bundles typed earlier (the
 * screen says so and offers to discard them).
 */
export function usePackDraft(companyId: string, userId: string) {
  const [draft, setDraft] = useState<PackDraft>(() => owned(readDraft(sessionStore(), companyId, userId), userId) ?? emptyDraft(companyId, userId));
  const restored = useRef(draft.bundles.length > 0);
  // Set once the session is saved: storage is cleared and stays cleared while the screen leaves.
  const finished = useRef(false);

  // Another company (impersonation) or person in this tab: start fresh for them.
  useEffect(() => {
    setDraft((d) =>
      d.companyId === companyId && d.userId === userId
        ? d
        : (owned(readDraft(sessionStore(), companyId, userId), userId) ?? emptyDraft(companyId, userId)),
    );
  }, [companyId, userId]);

  useEffect(() => {
    if (!finished.current) writeDraft(sessionStore(), draft);
  }, [draft]);

  const update = useCallback((fn: (d: PackDraft) => PackDraft) => setDraft(fn), []);

  const discard = useCallback(() => {
    clearDraft(sessionStore());
    restored.current = false;
    setDraft(emptyDraft(companyId, userId));
  }, [companyId, userId]);

  /** After a successful save: forget the stored draft but keep the screen as it is while it navigates away. */
  const finish = useCallback(() => {
    finished.current = true;
    clearDraft(sessionStore());
  }, []);

  return { draft, update, discard, finish, restored: restored.current };
}
