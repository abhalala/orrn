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
};

export type PackStep = 0 | 1 | 2;

export type PackDraft = {
  v: 1;
  /** Guards against a draft from another company in the same tab (impersonation, switching). */
  companyId: string;
  step: PackStep;
  dieId: string | null;
  /**
   * Session defaults. `lengthMm` 0 = not entered yet. `locationId` is the yard
   * the bundles go to (required by the server once the company has yards).
   */
  defaults: { lengthMm: number; po?: string; locationId?: string };
  bundles: DraftBundle[];
};

export function emptyDraft(companyId: string): PackDraft {
  return { v: 1, companyId, step: 0, dieId: null, defaults: { lengthMm: 0 }, bundles: [] };
}

export function isDraftEmpty(d: PackDraft): boolean {
  return d.dieId === null && d.bundles.length === 0 && !(d.defaults.lengthMm > 0) && !d.defaults.po;
}

const isPosInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

function isDraftBundle(b: unknown): b is DraftBundle {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  return (
    isPosInt(r.weightG) &&
    isPosInt(r.pieces) &&
    (r.lengthMm === undefined || isPosInt(r.lengthMm)) &&
    (r.po === undefined || typeof r.po === "string")
  );
}

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
    ![0, 1, 2].includes(d.step as number) ||
    !(d.dieId === null || typeof d.dieId === "string") ||
    !defaults ||
    typeof defaults !== "object" ||
    typeof defaults.lengthMm !== "number" ||
    !(defaults.lengthMm >= 0) ||
    !(defaults.po === undefined || typeof defaults.po === "string") ||
    !(defaults.locationId === undefined || typeof defaults.locationId === "string") ||
    !Array.isArray(d.bundles) ||
    d.bundles.length > MAX_BUNDLES ||
    !d.bundles.every(isDraftBundle)
  ) {
    return null;
  }
  return data as PackDraft;
}

/** The stored draft for this company, or null (none, corrupt, another company, or storage blocked). */
export function readDraft(storage: Storage | null, companyId: string): PackDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PACK_DRAFT_KEY);
    if (!raw) return null;
    const draft = parseDraft(raw);
    return draft && draft.companyId === companyId ? draft : null;
  } catch {
    return null;
  }
}

/** Stores the draft (an empty one is removed instead). Never throws: storage is a convenience. */
export function writeDraft(storage: Storage | null, draft: PackDraft): void {
  if (!storage) return;
  try {
    if (isDraftEmpty(draft)) storage.removeItem(PACK_DRAFT_KEY);
    else storage.setItem(PACK_DRAFT_KEY, JSON.stringify(draft));
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

export type ReceiptInput = {
  dieId: string;
  unit: string;
  purchaseOrderRef: string | null;
  /** The yard; left out for companies without yard locations. */
  locationId?: string;
  rows: { quantity: number; weightG: number; lengthMm: number; poNumber: string | null }[];
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
  return {
    dieId: d.dieId,
    unit,
    purchaseOrderRef: cleanPo(d.defaults.po),
    ...(locationId ? { locationId } : {}),
    rows: d.bundles.map((b) => ({
      quantity: b.pieces,
      weightG: b.weightG,
      lengthMm: b.lengthMm ?? d.defaults.lengthMm,
      poNumber: b.po === undefined ? null : cleanPo(b.po),
    })),
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
export function usePackDraft(companyId: string) {
  const [draft, setDraft] = useState<PackDraft>(() => readDraft(sessionStore(), companyId) ?? emptyDraft(companyId));
  const restored = useRef(draft.bundles.length > 0);
  // Set once the session is saved: storage is cleared and stays cleared while the screen leaves.
  const finished = useRef(false);

  // Another company in this tab (impersonation): start fresh for it.
  useEffect(() => {
    setDraft((d) => (d.companyId === companyId ? d : (readDraft(sessionStore(), companyId) ?? emptyDraft(companyId))));
  }, [companyId]);

  useEffect(() => {
    if (!finished.current) writeDraft(sessionStore(), draft);
  }, [draft]);

  const update = useCallback((fn: (d: PackDraft) => PackDraft) => setDraft(fn), []);

  const discard = useCallback(() => {
    clearDraft(sessionStore());
    restored.current = false;
    setDraft(emptyDraft(companyId));
  }, [companyId]);

  /** After a successful save: forget the stored draft but keep the screen as it is while it navigates away. */
  const finish = useCallback(() => {
    finished.current = true;
    clearDraft(sessionStore());
  }, []);

  return { draft, update, discard, finish, restored: restored.current };
}
