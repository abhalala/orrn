/**
 * The approvals inbox's reading of one request (spec P9 "approve"): its tone,
 * a one-line subject built from the request's meta, where it links to, and
 * whether this person may decide it. `approval.list` is readable by every
 * role, so meta is treated as data: ids only become links when they look like
 * ids.
 */
import type { StatusTone } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import type { MoveFacts, TierFacts } from "@orrn/server/lib/approvalFacts";
import { canAny, canApprove, type Action, type ApprovalKind, type Me } from "@orrn/server/lib/permissions";

import type { ApprovalStatus } from "./approval-filter";

export { APPROVAL_KINDS, isApprovalKind, type ApprovalStatus } from "./approval-filter";

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
  /** Label of the link to the subject ("Open lot"), null when there is no screen for it yet. */
  openKey: MessageKey | null;
};

/** uuid-ish or the seed's readable ids: letters, digits, dashes and underscores only. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const safeId = (v: unknown): string | null => (typeof v === "string" && SAFE_ID.test(v) ? v : null);

/** One end of a move (BACKLOG 34): an order line of a customer, or null for plant stock. */
export type MoveEndView = { customerName: string; orderNumber: string; lineNo: number } | null;

/** What an `order_reallocate` request moves, read from its meta (server's `ReallocateMove`). */
export type ReallocateView = {
  count: number;
  kgG: number;
  from: MoveEndView[];
  to: MoveEndView;
  bundles: { serial: string; weightG: number; from: MoveEndView }[];
  reasonCode: string | null;
  /** The order the bundles are on now (the first one asked from), for "Open order". */
  orderId: string | null;
};

function endOf(v: unknown): MoveEndView {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.customerName !== "string" || typeof o.orderNumber !== "string" || typeof o.lineNo !== "number") return null;
  return { customerName: o.customerName, orderNumber: o.orderNumber, lineNo: o.lineNo };
}

/** The move of an `order_reallocate` request, or null for a request made before the summary existed. */
export function reallocateMoveOf(meta: Record<string, unknown> | null | undefined): ReallocateView | null {
  const m = meta ?? {};
  const move = m.move && typeof m.move === "object" ? (m.move as Record<string, unknown>) : null;
  if (!move || typeof move.count !== "number" || typeof move.kgG !== "number") return null;
  const bundles = Array.isArray(move.bundles)
    ? (move.bundles as unknown[]).flatMap((b) => {
        if (!b || typeof b !== "object") return [];
        const o = b as Record<string, unknown>;
        return typeof o.serial === "string" && typeof o.weightG === "number" ? [{ serial: o.serial, weightG: o.weightG, from: endOf(o.from) }] : [];
      })
    : [];
  const orderIds = Array.isArray(m.orderIds) ? (m.orderIds as unknown[]).map(safeId).filter((x): x is string => x !== null) : [];
  return {
    count: move.count,
    kgG: move.kgG,
    from: Array.isArray(move.from) ? (move.from as unknown[]).map(endOf) : [],
    to: endOf(move.to),
    bundles,
    reasonCode: typeof m.reasonCode === "string" ? m.reasonCode : null,
    orderId: orderIds[0] ?? null,
  };
}

/** "KD Extrusion SO-4" for a line, the plant word for plant stock. */
export function moveEndText(end: MoveEndView, plant: string): string {
  return end ? `${end.customerName} ${end.orderNumber}` : plant;
}

/** The distinct customers a move comes from ("KD Extrusion", "KD Extrusion, plant stock"). */
export function moveFromText(from: readonly MoveEndView[], plant: string): string {
  return [...new Set(from.map((e) => (e ? e.customerName : plant)))].join(", ");
}

/** Kilograms to the gram, as the order screens print them ("57.046"). */
const KG3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const moveKgText = (grams: number) => KG3.format(grams / 1000);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Percent text of basis points ("2.9"), "" when absent. */
const bpPct = (bp: number | null) => (bp === null ? "" : (Math.abs(bp) / 100).toFixed(1));

/** A figure of a foundry request, shown in the review sheet: the label key and the already formatted value. */
export type FoundryFigure = { labelKey: MessageKey; value: string };

/**
 * What a `cast_close` or `melt_correct` request is about (W2-FD-W), read from its meta: the cast's
 * billets produced, the tail and its share, or the melt's metal in and logs. Absent figures are
 * left out (a request made before a figure existed).
 */
export function foundryFiguresOf(kind: ApprovalKind, meta: Record<string, unknown> | null | undefined): FoundryFigure[] {
  const m = meta ?? {};
  const rows: FoundryFigure[] = [];
  const kg = (g: number | null, labelKey: MessageKey) => {
    if (g !== null) rows.push({ labelKey, value: `${moveKgText(g)} kg` });
  };
  if (kind === "cast_close") {
    kg(num(m.producedG), "approvals.foundry.produced");
    kg(num(m.inputG), "approvals.foundry.metalIn");
    kg(num(m.ledgerOnHandG), "approvals.foundry.ledgerOnHand");
    kg(num(m.countedG), "approvals.foundry.counted");
    const adjust = num(m.adjustG);
    if (adjust !== null && adjust !== 0) rows.push({ labelKey: "approvals.foundry.adjust", value: `${adjust < 0 ? "-" : "+"}${moveKgText(Math.abs(adjust))} kg` });
    const tail = num(m.tailG);
    if (tail !== null) {
      const pct = bpPct(num(m.tailBp));
      rows.push({ labelKey: "approvals.foundry.tail", value: `${tail < 0 ? "-" : ""}${moveKgText(Math.abs(tail))} kg${pct ? ` (${pct}%)` : ""}` });
    }
    kg(num(m.shortG) && num(m.shortG)! > 0 ? num(m.shortG) : null, "approvals.foundry.short");
  } else if (kind === "melt_correct") {
    kg(num(m.inputG), "approvals.foundry.metalIn");
    kg(num(m.logsG), "approvals.foundry.logs");
  }
  return rows;
}

/** The cast a foundry request is about: the subject of a close, the `castId` in a correction's meta. */
export function foundryCastIdOf(kind: ApprovalKind, subjectId: string, meta: Record<string, unknown> | null | undefined): string | null {
  if (kind === "cast_close") return safeId(subjectId);
  if (kind === "melt_correct") return safeId((meta ?? {}).castId);
  return null;
}

/** What `foundry.casts.get` gives the sheet, narrowed to the figures a decision needs. */
export type FoundryLiveSource = {
  cast: { status: string };
  closeout: { producedG: number; inputG: number; billetsOnHandG: number };
  melts: { id: string; status: string; inputG: number; logsG: number }[];
};

/** A line under the live figures: a message key and, for the kg ones, the kilograms already formatted. */
export type FoundryLiveNote = { key: MessageKey; kg?: string };

/**
 * The live side of a foundry request (W2-FD-W review I1): the figures as the ledger and the melt
 * stand now, plus what changed since the request was made. The request's own meta stays the
 * "when it was asked" block. `null` when the live rows do not hold the subject (the sheet then
 * keeps Approve off).
 */
export function foundryLiveOf(
  kind: ApprovalKind,
  subjectId: string,
  meta: Record<string, unknown> | null | undefined,
  live: FoundryLiveSource,
): { rows: FoundryFigure[]; notes: FoundryLiveNote[] } | null {
  const m = meta ?? {};
  const kg = (g: number, labelKey: MessageKey): FoundryFigure => ({ labelKey, value: `${moveKgText(g)} kg` });
  if (kind === "cast_close") {
    const notes: FoundryLiveNote[] = [];
    const asked = num(m.ledgerOnHandG);
    const now = live.closeout.billetsOnHandG;
    if (asked !== null && now < asked) notes.push({ key: "approvals.foundry.usedSince", kg: moveKgText(asked - now) });
    else if (asked !== null && now > asked) notes.push({ key: "approvals.foundry.addedSince", kg: moveKgText(now - asked) });
    if (live.cast.status !== "closing") notes.push({ key: "approvals.foundry.castMoved" });
    return {
      rows: [kg(live.closeout.producedG, "approvals.foundry.produced"), kg(live.closeout.inputG, "approvals.foundry.metalIn"), kg(now, "approvals.foundry.ledgerOnHand")],
      notes,
    };
  }
  if (kind === "melt_correct") {
    const melt = live.melts.find((x) => x.id === subjectId);
    if (!melt) return null;
    const notes: FoundryLiveNote[] = melt.status !== "locked" || live.cast.status !== "open" ? [{ key: "approvals.foundry.meltMoved" }] : [];
    return { rows: [kg(melt.inputG, "approvals.foundry.metalIn"), kg(melt.logsG, "approvals.foundry.logs")], notes };
  }
  return null;
}

/** What a `press_late_entry` request asks to accept (H1): the run, its press and copy, the times typed. */
export type LateEntryView = {
  runId: string | null;
  runNumber: string;
  pressLineCode: string | null;
  copyCode: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  productionDay: string | null;
  shiftSeq: number | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The late entry of a `press_late_entry` request (older requests carry only the run number). */
export function lateEntryOf(row: Pick<ApprovalForView, "subjectId" | "meta">): LateEntryView {
  const m = row.meta ?? {};
  return {
    runId: safeId(row.subjectId),
    runNumber: text(m.runNumber),
    pressLineCode: str(m.pressLineCode),
    copyCode: str(m.copyCode),
    startedAt: num(m.startedAt),
    stoppedAt: num(m.stoppedAt),
    productionDay: str(m.productionDay),
    shiftSeq: num(m.shiftSeq),
  };
}

function zonedParts(at: number, timeZone: string): { day: string; month: string; hour: string; minute: string } {
  const fmt = (tz: string | undefined) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt(undefined);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

/**
 * "24 Oct 21:00" in the plant's time zone (not the device's), built from parts so the wording is
 * the same on every ICU.
 */
export function plantTimeText(at: number, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/** "24 Oct 21:00 to 23:00", or both dates when the run crosses midnight. */
export function lateWindowText(startedAt: number, stoppedAt: number, timeZone: string): string {
  const a = zonedParts(startedAt, timeZone);
  const b = zonedParts(stoppedAt, timeZone);
  const sameDay = a.day === b.day && a.month === b.month;
  return `${a.day} ${a.month} ${a.hour}:${a.minute} to ${sameDay ? "" : `${b.day} ${b.month} `}${b.hour}:${b.minute}`;
}

/** "2 h 05 min" between two instants. */
export function durationText(fromMs: number, toMs: number): string {
  const min = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0 ? `${h} h ${String(mm).padStart(2, "0")} min` : `${mm} min`;
}

/** Words the subject line borrows from the screen's language. */
export type SubjectWords = { plant: string; mainBand?: string; otherBand?: string };

/**
 * One end of a band lift (M6): the band's label or kg range as the server wrote it, the main band
 * for no band id, "another band" for an older request that only kept the id.
 */
function bandEnd(id: unknown, label: unknown, words: SubjectWords): string {
  const named = str(label);
  if (named) return named;
  return id == null ? (words.mainBand ?? "main band") : (words.otherBand ?? "another band");
}

export function approvalSubject(row: ApprovalForView, words: SubjectWords = { plant: "plant stock" }): ApprovalSubject {
  const kindKey = `approvals.kind.${row.kind}` as MessageKey;
  const m = row.meta ?? {};
  if (row.kind === "press_late_entry") {
    const late = lateEntryOf(row);
    const href = late.runId ? `/press/runs/${late.runId}` : null;
    const openKey: MessageKey | null = href ? "approvals.openRun" : null;
    if (late.runNumber && late.pressLineCode) {
      return { kindKey, titleKey: "approvals.subject.lateEntry", vars: { number: late.runNumber, line: late.pressLineCode }, href, openKey };
    }
    if (late.runNumber) return { kindKey, titleKey: "approvals.subject.lateEntryNoLine", vars: { number: late.runNumber }, href, openKey };
    return { kindKey, titleKey: "approvals.subject.generic", vars: { ref: "" }, href, openKey };
  }
  if (row.kind === "order_reallocate") {
    const move = reallocateMoveOf(m);
    if (move) {
      return {
        kindKey,
        titleKey: "approvals.subject.reallocate",
        vars: { count: move.count, kg: moveKgText(move.kgG), from: moveFromText(move.from, words.plant), to: moveEndText(move.to, words.plant) },
        href: move.orderId ? `/orders/${move.orderId}` : null,
        openKey: move.orderId ? "approvals.openOrder" : null,
      };
    }
  }
  if (row.kind === "dc_note") {
    const lotId = safeId(m.lotId);
    return {
      kindKey,
      titleKey: m.type === "credit" ? "approvals.subject.dcCredit" : "approvals.subject.dcDebit",
      vars: { number: text(m.number), lot: text(m.lotNumber) },
      href: lotId ? `/purchase/${lotId}` : null,
      openKey: lotId ? "approvals.openLot" : null,
    };
  }
  if (row.kind === "die_rerank") {
    const sectionId = safeId(m.sectionId);
    const to = typeof m.toRank === "number" ? m.toRank : text(m.toRank);
    const href = sectionId ? `/dies/${sectionId}` : null;
    const openKey: MessageKey | null = sectionId ? "approvals.openDie" : null;
    // M6: a band lift names the bands ("main band to Heavy 2.600-2.800"), not "tier 2 to 2".
    if (m.isLift === true) {
      const vars = { code: text(m.code), from: bandEnd(m.fromBandId, m.fromBandText, words), to: bandEnd(m.toBandId, m.toBandText, words) };
      if (typeof m.fromRank === "number" && typeof m.toRank === "number" && m.fromRank !== m.toRank) {
        return { kindKey, titleKey: "approvals.subject.dieLiftRank", vars: { ...vars, fromRank: m.fromRank, toRank: m.toRank }, href, openKey };
      }
      return { kindKey, titleKey: "approvals.subject.dieLift", vars, href, openKey };
    }
    // A copy with no tier yet gets "set tier", not "tier  to 1".
    if (typeof m.fromRank !== "number") {
      return { kindKey, titleKey: "approvals.subject.dieRerankNew", vars: { code: text(m.code), to }, href, openKey };
    }
    return { kindKey, titleKey: "approvals.subject.dieRerank", vars: { code: text(m.code), from: m.fromRank, to }, href, openKey };
  }
  if (row.kind === "cast_close") {
    const castNumber = text(m.number);
    const tail = num(m.tailG);
    return {
      kindKey,
      titleKey: tail === null ? "approvals.subject.castCloseBare" : "approvals.subject.castClose",
      vars: { number: castNumber, kg: tail === null ? "" : moveKgText(Math.abs(tail)) },
      href: safeId(row.subjectId) ? `/casts/${row.subjectId}` : null,
      openKey: safeId(row.subjectId) ? "approvals.openCast" : null,
    };
  }
  if (row.kind === "melt_correct") {
    const castId = safeId(m.castId);
    const meltId = safeId(row.subjectId);
    return {
      kindKey,
      titleKey: "approvals.subject.meltCorrect",
      vars: { number: text(m.castNumber), seq: text(m.meltSeq) },
      href: castId && meltId ? `/casts/${castId}/melt/${meltId}` : null,
      openKey: castId && meltId ? "approvals.openMelt" : null,
    };
  }
  return {
    kindKey,
    titleKey: "approvals.subject.generic",
    vars: { ref: text(m.code) || text(m.number) || text(m.serial) },
    href: null,
    openKey: null,
  };
}

export type TitlePart = { text: string; code: boolean };

/**
 * Cut a translated title into plain text and the codes in it ("LOT-13",
 * "DCN-2"), so the screen can keep each code on one line: browsers break
 * after a hyphen, and "LOT-" / "13" on two lines misreads. Longer codes win
 * over shorter ones they contain ("LOT-12" before "LOT-1").
 */
export function splitCodes(title: string, codes: readonly string[]): TitlePart[] {
  const wanted = [...new Set(codes.filter((c) => c.length > 0))].sort((a, b) => b.length - a.length);
  const parts: TitlePart[] = [];
  let plain = "";
  let i = 0;
  while (i < title.length) {
    const code = wanted.find((c) => title.startsWith(c, i));
    if (code) {
      if (plain) parts.push({ text: plain, code: false });
      plain = "";
      parts.push({ text: code, code: true });
      i += code.length;
    } else {
      plain += title[i];
      i += 1;
    }
  }
  if (plain || parts.length === 0) parts.push({ text: plain, code: false });
  return parts;
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

/** The same for places that take plain text (a sheet title): a word joiner (U+2060) after each hyphen inside a code. */
export function unbrokenCodes(title: string, codes: readonly string[]): string {
  return splitCodes(title, codes)
    .map((p) => (p.code ? p.text.replaceAll("-", "-⁠") : p.text))
    .join("");
}

/** The codes an approval title can carry (note, lot and die copy numbers; an order number at the end of a move). */
export function subjectCodes(subject: ApprovalSubject): string[] {
  const codes = ["number", "lot", "code", "ref"].map((k) => subject.vars[k]).filter((v): v is string => typeof v === "string");
  const to = subject.vars.to;
  const order = typeof to === "string" ? /\b[A-Z]{1,4}-\d+$/.exec(to)?.[0] : undefined;
  return order ? [...codes, order] : codes;
}

/** The server's `purchaseReader`: who may read scrap purchase figures and lots. */
export const PURCHASE_READERS: readonly Action[] = ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"];

/**
 * The subject's link works for this person: a D/C note opens its lot only for purchase readers
 * (foundry and die room see the inbox but not purchase, and would land on a refusal).
 */
export function canOpenSubject(me: Me | null | undefined, row: ApprovalForView): boolean {
  if (!me) return false;
  if (row.kind === "dc_note") return canAny(me, PURCHASE_READERS);
  return true;
}

/** Inbox page size. `approval.list` caps limit at 200, so pages grow by offset, never by limit. */
export const APPROVALS_PAGE = 25;

export function approvalsPageInput(filter: { status: ApprovalStatus; kind: ApprovalKind | undefined }, offset: number) {
  return { status: filter.status, kind: filter.kind, limit: APPROVALS_PAGE, offset };
}

/** The next page's offset from the server's `nextOffset` (undefined ends "Show more"). */
export function nextApprovalsOffset(last: { nextOffset: number | null }): number | undefined {
  return last.nextOffset ?? undefined;
}

/** Kinds whose sheet reads live facts (`approval.facts`) before Approve opens (BACKLOG 89). */
export const FACT_KINDS = ["order_reallocate", "die_rerank"] as const satisfies readonly ApprovalKind[];
export function hasLiveFacts(kind: string): boolean {
  return (FACT_KINDS as readonly string[]).includes(kind);
}

/** A move request as it stands now: who would move, who gets a new party number, what is skipped. */
export function moveFactsView(f: MoveFacts) {
  const total = f.bundles.length;
  const moving = f.willMove.count;
  return {
    total,
    moving,
    kgG: f.willMove.kgG,
    skipped: total - moving,
    nothingMoves: moving === 0,
    closed: f.target === null || !f.target.orderOpen,
    partyRule: f.target?.partyRule ?? ("serial" as const),
    customer: f.target?.customerName ?? "",
    rows: f.bundles.map((b) => ({
      serial: b.serial,
      partyNo: b.partyNo,
      weightG: b.weightG,
      willMove: b.willMove,
      /** Moves AND takes a new number. */
      newNumber: b.willMove && b.renumbers,
    })),
  };
}

/** A tier change as it stands now: the copy now, what is asked, the last reading against the band. */
export function tierFactsView(f: TierFacts, words: { mainBand: string }) {
  const r = f.reading;
  const position: "above" | "below" | "inside" | null = r ? (r.kgPer12ftMilli > f.copy.band.maxG ? "above" : r.kgPer12ftMilli < f.copy.band.minG ? "below" : "inside") : null;
  const rank = (n: number | null) => (n === null ? null : String(n));
  return {
    code: f.copy.code,
    nowTier: rank(f.copy.tierRank),
    askedFromTier: rank(f.request.fromRank),
    askedToTier: String(f.request.toRank),
    tierChanges: f.request.fromRank !== f.request.toRank,
    nowBand: f.copy.band.main ? `${words.mainBand} ${f.copy.band.text}` : f.copy.band.text,
    bandChange: f.request.isLift
      ? { from: f.request.fromBandText ?? words.mainBand, to: f.request.toBandText ?? words.mainBand }
      : null,
    readingKg: r ? (r.kgPer12ftMilli / 1000).toFixed(3) : null,
    readAt: r ? r.readAt : null,
    position,
    changedSince: f.changedSince,
  };
}
