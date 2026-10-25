/**
 * What a refused press write says on the tablet (review r1 I-3). The server's refusals are plain
 * English sentences; a Hindi or Gujarati floor screen must not show them. Every refusal this
 * module knows is matched here and spoken from the screen's own dictionary (`press.console.errors.*`,
 * `press.console.gates.*`); a refusal it does not know shows a generic sentence in the person's
 * language with the server's text as a smaller second line, so nothing is hidden and nothing is
 * mistaken for the screen's own words. Pure: unit-tested without React.
 */
import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";

import { actionErrorText } from "@/features/dispatch/errors";

import { gateKey } from "./model";

type RefusalCode = "BAD_REQUEST" | "CONFLICT";

export type PressRefusal = {
  id: string;
  /** The tRPC code the server raises it with (documentation and the test's sample). */
  code: RefusalCode;
  re: RegExp;
  key: MessageKey;
  vars?: (m: RegExpExecArray, t: Translate) => TranslateVars;
  /** A real message the pattern must match. */
  sample: string;
  /** A fixed piece of the server's text; the test checks the server source still carries it. */
  src: string;
};

const E = (name: string) => `press.console.errors.${name}` as MessageKey;

/** The server's run state words (`STATUS_WORD` in the press router) and the status they name. */
const STATE_OF_WORD: Record<string, string> = {
  queued: "queued",
  "waiting to start": "die_issued",
  running: "running",
  stopped: "stopped",
  "being counted": "counting",
  logged: "logged",
  voided: "voided",
};
const STATE_WORDS = Object.keys(STATE_OF_WORD).join("|");

const stateVar = (word: string, t: Translate) => t(`press.console.status.${STATE_OF_WORD[word] ?? "queued"}` as MessageKey);

/** Order matters: the specific sentences come before the general ones. */
export const PRESS_REFUSALS: readonly PressRefusal[] = [
  { id: "busy", code: "CONFLICT", re: /(?:Another run|\S+) is running on this press; stop it first/, key: "press.console.busy", sample: "Another run is running on this press; stop it first", src: "is running on this press; stop it first" },
  { id: "downtimeRunning", code: "CONFLICT", re: /already has downtime running/, key: E("downtimeRunning"), sample: "P1 already has downtime running; stop it first", src: "already has downtime running; stop it first" },
  { id: "pickOrderLine", code: "BAD_REQUEST", re: /^Pick the order line for (\d+(?:\.\d+)?) mm$/, key: "press.console.pickOrderLine", vars: (m) => ({ mm: m[1]! }), sample: "Pick the order line for 3658 mm", src: "Pick the order line for" },
  { id: "lateWindow", code: "BAD_REQUEST", re: /^A late entry must be within (\d+) days$/, key: E("lateWindow"), vars: (m) => ({ days: m[1]! }), sample: "A late entry must be within 7 days", src: "A late entry must be within" },
  { id: "lateStopped", code: "BAD_REQUEST", re: /^A late entry is for a run that has already stopped$/, key: E("lateStopped"), sample: "A late entry is for a run that has already stopped", src: "A late entry is for a run that has already stopped" },
  { id: "stopAfterStart", code: "BAD_REQUEST", re: /^The run must stop after it starts$/, key: E("stopAfterStart"), sample: "The run must stop after it starts", src: "The run must stop after it starts" },
  { id: "startLocked", code: "BAD_REQUEST", re: /^Die not issued\. Start is locked\.$/, key: "press.console.startLocked", sample: "Die not issued. Start is locked.", src: "Die not issued. Start is locked." },
  { id: "dieElsewhere", code: "BAD_REQUEST", re: /^The die issued is for another run or press/, key: E("dieElsewhere"), sample: "The die issued is for another run or press; ask the die room", src: "The die issued is for another run or press" },
  { id: "stateNow", code: "CONFLICT", re: new RegExp(`^(\\S+) is (${STATE_WORDS})(?: now)?;`), key: E("stateNow"), vars: (m, t) => ({ number: m[1]!, state: stateVar(m[2]!, t) }), sample: "PR-3 is being counted now; Count and check was not saved. Reload.", src: "was not saved. Reload." },
  { id: "changedLogging", code: "CONFLICT", re: /^(\S+) changed while it was being logged/, key: E("changedLogging"), vars: (m) => ({ number: m[1]! }), sample: "PR-3 changed while it was being logged. Reload and log again.", src: "changed while it was being logged" },
  { id: "billetsLeft", code: "CONFLICT", re: /^Only ([\d.,]+) kg of cast \S+ is left in the billet store/, key: E("billetsLeft"), vars: (m) => ({ kg: m[1]! }), sample: "Only 2.400 kg of cast K31 is left in the billet store now. Check the billets and log again.", src: "is left in the billet store now" },
  { id: "changedMeanwhile", code: "CONFLICT", re: /\bmeanwhile\b/, key: E("changedMeanwhile"), sample: "PR-3 changed meanwhile; nothing was pulled back", src: "changed meanwhile; nothing was pulled back" },
  { id: "alreadySaved", code: "CONFLICT", re: /^This entry was already saved$/, key: E("alreadySaved"), sample: "This entry was already saved", src: "This entry was already saved" },
  { id: "reopenWaiting", code: "CONFLICT", re: /^(\S+) already waits for a reopen decision$/, key: E("reopenWaiting"), vars: (m) => ({ number: m[1]! }), sample: "PR-3 already waits for a reopen decision", src: "already waits for a reopen decision" },
  { id: "notMember", code: "BAD_REQUEST", re: /^That person is not a member of this plant$/, key: E("notMember"), sample: "That person is not a member of this plant", src: "That person is not a member of this plant" },
  { id: "operatorRole", code: "BAD_REQUEST", re: /^The operator must be someone who runs the press$/, key: E("operatorRole"), sample: "The operator must be someone who runs the press", src: "The operator must be someone who runs the press" },
  { id: "supervisorRole", code: "BAD_REQUEST", re: /^The supervisor must be someone who can log runs$/, key: E("supervisorRole"), sample: "The supervisor must be someone who can log runs", src: "The supervisor must be someone who can log runs" },
  { id: "lineHasRun", code: "BAD_REQUEST", re: /^(\S+) is still open on (\S+); finish or void it first$/, key: E("lineHasRun"), vars: (m) => ({ number: m[1]!, line: m[2]! }), sample: "PR-3 is still open on P1; finish or void it first", src: "finish or void it first" },
  { id: "hasStarted", code: "BAD_REQUEST", re: /^(\S+) has started\b/, key: E("hasStarted"), vars: (m) => ({ number: m[1]! }), sample: "PR-3 has started; only queued runs move", src: "has started; only queued runs move" },
  { id: "castCancelled", code: "BAD_REQUEST", re: /^That cast is cancelled$/, key: E("castCancelled"), sample: "That cast is cancelled", src: "That cast is cancelled" },
  { id: "pickReason", code: "BAD_REQUEST", re: /^Pick a reject reason from the list$/, key: E("pickReason"), sample: "Pick a reject reason from the list", src: "Pick a reject reason from the list" },
  { id: "timeSkew", code: "BAD_REQUEST", re: /device time differs from server time/, key: E("timeSkew"), sample: "PR-3: device time differs from server time by more than 2 minutes", src: "device time differs from server time" },
  { id: "copyOnTrial", code: "BAD_REQUEST", re: /^(\S+) is on trial;/, key: E("copyOnTrial"), vars: (m) => ({ code: m[1]! }), sample: "D-1 is on trial; it goes only to a die trial run until the trial passes or a manager releases it", src: "is on trial; it goes only to a die trial run" },
  { id: "copyIssued", code: "CONFLICT", re: /^(\S+) is already issued to (\S+)$/, key: E("copyIssued"), vars: (m) => ({ code: m[1]!, line: m[2]! }), sample: "D-1 is already issued to P1", src: "is already issued to" },
  { id: "copyElsewhere", code: "BAD_REQUEST", re: /^(\S+) (?:is already issued to a press|is out at nitriding|is at the die maker)$/, key: E("copyElsewhere"), vars: (m) => ({ code: m[1]! }), sample: "D-1 is out at nitriding", src: "is out at nitriding" },
  { id: "lineExists", code: "CONFLICT", re: /^There is already a press (\S+)$/, key: E("lineExists"), vars: (m) => ({ code: m[1]! }), sample: "There is already a press P3", src: "There is already a press" },
  { id: "retired", code: "BAD_REQUEST", re: /^(\S+) is retired(?:; it takes no readings)?$/, key: E("retired"), vars: (m) => ({ code: m[1]! }), sample: "P1 is retired", src: "is retired" },
];

export function classifyRefusal(message: string): PressRefusal | null {
  for (const r of PRESS_REFUSALS) if (r.re.test(message)) return r;
  return null;
}

type TrpcLike = { message?: unknown; data?: { code?: unknown; meta?: { gates?: unknown; ownerName?: unknown; billetsOnHandG?: unknown } } | null };
const asTrpc = (error: unknown): TrpcLike => (error && typeof error === "object" ? (error as TrpcLike) : {});

/** The gate codes a refused `press.runs.close` carries (server `TRPCMetaError`), or null. */
export function gatesOf(error: unknown): string[] | null {
  const gates = asTrpc(error).data?.meta?.gates;
  return Array.isArray(gates) && gates.every((g) => typeof g === "string") ? (gates as string[]) : null;
}

/** True when the request never reached the server (offline, dropped): keep the form, offer Try again. */
export function isNetworkError(error: unknown): boolean {
  return asTrpc(error).data?.code === undefined;
}

/** What a refused billets save says about the store (server `meta.billetsOnHandG`), when it does. */
export function billetsOnHandOf(error: unknown): number | null {
  const g = asTrpc(error).data?.meta?.billetsOnHandG;
  return typeof g === "number" ? g : null;
}

export type PressErrorView = { text: string; detail: string | null };

export type PressErrorOpts = {
  /** The caller's own sentence for an unknown refusal, in place of the generic one. */
  fallback?: MessageKey;
  /** An unmapped CONFLICT carries a reason the server worked out (reopen blockers): quote it. */
  conflictReason?: boolean;
};

const kgText = (g: number) => (Math.round(g) / 1000).toFixed(3).replace(/\.?0+$/, "");

/** The server's words as a secondary line: only a short plain sentence, never a zod dump. */
function detailOf(message: string): string | null {
  const m = message.trim();
  return m && !m.startsWith("[") && !m.startsWith("{") && m.length < 240 ? m : null;
}

export function pressErrorView(t: Translate, error: unknown, opts: PressErrorOpts = {}): PressErrorView {
  const e = asTrpc(error);
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === undefined) return { text: t("press.console.saveFailed"), detail: null };

  const owner = e.data?.meta?.ownerName;
  if (code === "FORBIDDEN" && typeof owner === "string" && owner) return { text: t("scan.continuous.dieOwned", { name: owner }), detail: null };

  const onHand = billetsOnHandOf(error);
  if (onHand !== null) return { text: t(E("billetsLeft"), { kg: kgText(onHand) }), detail: null };

  const gates = gatesOf(error);
  if (gates && gates.length > 0) {
    const sentences = gates.map((g, i) => {
      const key = gateKey(g);
      return key ? t(key) : (i === 0 ? message : g);
    });
    return { text: sentences.join(" "), detail: null };
  }

  const known = classifyRefusal(message);
  if (known && (code === "BAD_REQUEST" || code === "CONFLICT")) return { text: t(known.key, known.vars?.(known.re.exec(message)!, t)), detail: null };

  if (code === "CONFLICT" && opts.conflictReason && message) return { text: t(E("reopenBlocked"), { reason: message }), detail: null };

  if (code === "BAD_REQUEST" || code === "CONFLICT") {
    const base = code === "CONFLICT" && !opts.fallback ? t(E("conflict")) : t(opts.fallback ?? E("generic"));
    return { text: base, detail: detailOf(message) };
  }
  return { text: opts.fallback && code !== "FORBIDDEN" && code !== "UNAUTHORIZED" ? t(opts.fallback) : actionErrorText(t, error), detail: null };
}

/** One string for a toast or a state value: the sentence, then the server's text after a line break. */
export function joinErrorView(v: PressErrorView): string {
  return v.detail ? `${v.text}\n${v.detail}` : v.text;
}
