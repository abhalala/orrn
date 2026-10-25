import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_REASON_CODES } from "@orrn/domain";
import { en } from "@orrn/i18n/en";

import { cardBundle, asksReason, typedCount } from "../features/pack/pack-card";
import { DEFAULT_SOURCE, receiptPayload, type DraftBundle } from "../features/pack/pack-math";
import { PACK_REFUSALS, packSaveText, readReject, receiptRequestKey, REJECT_CODES, saveErrorKind, validSessionKey, withRequestKey } from "../features/pack/pack-submit";
import { partyNoLabel, partyRange } from "../features/pack/party";
import { copyLocked, sourceBlockers, withPinnedLine, withPinOverride } from "../features/pack/source-gate";
import { gramsToFieldText, scaleView, typedWeightNeedsReason, viewForReason, weightProvenance } from "../features/pack/scale-view";
import { positionKey, previewReady } from "../features/pack/line-preview";
import { replayKey, noReply, sendOnce } from "../lib/replay-key";

const REPO = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const bundle = (over: Partial<DraftBundle> = {}): DraftBundle => ({ key: "k1", weightG: 52_400, pieces: 21, lengthMm: null, po: null, ...over });
const base = { dieId: "die-1", unit: "inch" as const, defaults: { lengthMm: 3658, po: "PO-7" }, locationId: "yard-1", bundles: [bundle()] };

describe("saving a session twice never packs it twice (BACKLOG 50)", () => {
  const nonce = "0123456789abcdef";

  test("the same session and the same bundles give the same request id, which the server accepts", () => {
    const payload = receiptPayload({ ...base, source: DEFAULT_SOURCE });
    const a = withRequestKey(nonce, payload);
    const b = withRequestKey(nonce, receiptPayload({ ...base, source: DEFAULT_SOURCE }));
    expect(a.clientRequestId).toBe(b.clientRequestId);
    expect(a.clientRequestId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  test("the id is not part of what it is a tag of: asking for it twice gives the same one", () => {
    const payload = receiptPayload({ ...base, source: DEFAULT_SOURCE });
    const once = withRequestKey(nonce, payload);
    expect(receiptRequestKey(nonce, payload)).toBe(once.clientRequestId);
  });

  test("any change to bundles, rejects or choices is a different write and gets a different id", () => {
    const id = (over: Partial<Parameters<typeof receiptPayload>[0]>) => withRequestKey(nonce, receiptPayload({ ...base, source: DEFAULT_SOURCE, ...over })).clientRequestId;
    const first = id({});
    expect(id({ bundles: [bundle({ weightG: 52_500 })] })).not.toBe(first);
    expect(id({ bundles: [bundle(), bundle({ key: "k2" })] })).not.toBe(first);
    expect(id({ rejects: [{ pcs: 2, reasonCode: "bend" }] })).not.toBe(first);
    expect(id({ source: { showLogo: false } })).not.toBe(first);
    expect(id({ source: { showLogo: true, salesOrderLineId: "line-1" } })).not.toBe(first);
    expect(id({ locationId: "yard-2" })).not.toBe(first);
    // Reverting an edit reuses the old id: the same write sent again.
    expect(id({ bundles: [bundle()] })).toBe(first);
  });

  test("another session has another nonce, so the same bundles packed again are a new write", () => {
    const payload = receiptPayload({ ...base, source: DEFAULT_SOURCE });
    expect(withRequestKey("aaaaaaaaaaaaaaaa", payload).clientRequestId).not.toBe(withRequestKey("bbbbbbbbbbbbbbbb", payload).clientRequestId);
  });

  test("a stored nonce is only trusted when the server would take an id built from it", () => {
    expect(validSessionKey("0123456789abcdef")).toBe(true);
    expect(validSessionKey("short")).toBe(false);
    expect(validSessionKey("has space in it ok")).toBe(false);
    expect(validSessionKey(undefined)).toBe(false);
  });

  test("replayKey: same content reuses the id, edited content gets a new one, a saved write ends the attempt", () => {
    let n = 0;
    const fresh = () => `id-${++n}`;
    const first = replayKey(null, { a: 1 }, fresh);
    expect(first.id).toBe("id-1");
    expect(replayKey(first.attempt, { a: 1 }, fresh).id).toBe("id-1");
    expect(replayKey(first.attempt, { a: 2 }, fresh).id).toBe("id-2");
    expect(replayKey(null, { a: 1 }, fresh).id).toBe("id-3");
  });

  test("sendOnce: no reply sends the SAME key once more; a refusal is not sent again", async () => {
    const seen: string[] = [];
    const flaky = async (id: string) => {
      seen.push(id);
      if (seen.length === 1) throw new Error("Network request failed");
      return "ok";
    };
    expect(await sendOnce(flaky, "k-1")).toBe("ok");
    expect(seen).toEqual(["k-1", "k-1"]);

    const refused: string[] = [];
    const bad = async (id: string) => {
      refused.push(id);
      throw { data: { code: "BAD_REQUEST", httpStatus: 400 } };
    };
    await expect(sendOnce(bad, "k-2")).rejects.toBeTruthy();
    expect(refused).toEqual(["k-2"]);
    expect(noReply({ data: { httpStatus: 504 } })).toBe(true);
    expect(noReply({ data: { httpStatus: 409 } })).toBe(false);
  });
});

describe("the receipt carries what the Source step chose (D20, D15)", () => {
  test("no order line is Plant stock, written as plant stock; an order line is an order", () => {
    expect(receiptPayload({ ...base, source: DEFAULT_SOURCE })).toMatchObject({ source: "plant_stock" });
    expect(receiptPayload({ ...base, source: DEFAULT_SOURCE }).salesOrderLineId).toBeUndefined();
    expect(receiptPayload({ ...base, source: { showLogo: true, salesOrderLineId: "line-1", dieInstanceId: "copy-1", castId: "cast-1" } })).toMatchObject({
      source: "order",
      salesOrderLineId: "line-1",
      dieInstanceId: "copy-1",
      castId: "cast-1",
    });
  });

  test("overridePin goes along only for an order line with a copy; showLogo only when it was turned off", () => {
    const p = receiptPayload({ ...base, source: { showLogo: false, salesOrderLineId: "l", dieInstanceId: "c", overridePin: true } });
    expect(p.overridePin).toBe(true);
    expect(p.showLogo).toBe(false);
    const q = receiptPayload({ ...base, source: { showLogo: true, dieInstanceId: "c", overridePin: true } });
    expect(q.overridePin).toBeUndefined();
    expect(q.showLogo).toBeUndefined();
  });

  test("without a source the payload is the plain one older callers sent", () => {
    const p = receiptPayload({ ...base });
    expect("source" in p).toBe(false);
    expect("rejects" in p).toBe(false);
  });

  test("weight provenance and rejects travel with the rows", () => {
    const p = receiptPayload({
      ...base,
      source: DEFAULT_SOURCE,
      bundles: [bundle({ weightSource: "scale", scaleReadingG: 52_400 }), bundle({ key: "k2", weightSource: "manual", scaleReadingG: 51_900, weightOverrideReason: "  scale was off  " })],
      rejects: [{ pcs: 3, weightG: 6_000, reasonCode: "bend", note: " " }],
    });
    expect(p.rows[0]).toMatchObject({ weightSource: "scale", scaleReadingG: 52_400 });
    expect(p.rows[1]).toMatchObject({ weightSource: "manual", scaleReadingG: 51_900, weightOverrideReason: "scale was off" });
    expect(p.rejects).toEqual([{ pcs: 3, weightG: 6_000, reasonCode: "bend" }]);
  });

  test("the reject reasons are the seeded qc_reject codes, in order", () => {
    expect([...REJECT_CODES] as string[]).toEqual(DEFAULT_REASON_CODES.qc_reject.map((r) => r.code));
  });

  test("a reject needs pieces and a reason; Other needs a note; a typed weight must be real", () => {
    expect(readReject({ pcs: "", kg: "", reasonCode: "", note: "" })).toMatchObject({ ok: false, errors: { pcs: true, reason: true } });
    expect(readReject({ pcs: "2", kg: "", reasonCode: "other", note: " " })).toMatchObject({ ok: false, errors: { note: true } });
    expect(readReject({ pcs: "2", kg: "abc", reasonCode: "bend", note: "" })).toMatchObject({ ok: false, errors: { kg: true } });
    expect(readReject({ pcs: "2", kg: "1,5", reasonCode: "bend", note: "" })).toEqual({ ok: true, reject: { pcs: 2, weightG: 1500, reasonCode: "bend" } });
  });
});

describe("the Source step's gates mirror the server", () => {
  test("a line that pins a copy locks it; only the office's override frees it, and turning it off puts the pin back", () => {
    let choice = withPinnedLine({ showLogo: true }, "line-1", "copy-9");
    expect(choice).toMatchObject({ salesOrderLineId: "line-1", dieInstanceId: "copy-9" });
    expect(copyLocked(choice, "copy-9")).toBe(true);
    choice = withPinOverride({ ...choice, dieInstanceId: "copy-2" }, true, "copy-9");
    expect(choice.overridePin).toBe(true);
    expect(copyLocked(choice, "copy-9")).toBe(false);
    choice = withPinOverride(choice, false, "copy-9");
    expect(choice).toMatchObject({ dieInstanceId: "copy-9" });
    expect(choice.overridePin).toBeUndefined();
  });

  test("a cast is asked for when the plant says so; an owned die needs its copy", () => {
    const owner = { ok: false, block: "pick_copy" } as const;
    expect(sourceBlockers({ choice: { showLogo: true }, castRequired: true, owner })).toEqual([{ kind: "cast" }, { kind: "copy" }]);
    expect(sourceBlockers({ choice: { showLogo: true, castId: "c", dieInstanceId: "d" }, castRequired: true, owner: { ok: true } })).toEqual([]);
    expect(sourceBlockers({ choice: { showLogo: true }, castRequired: false, owner: { ok: false, block: "owned", ownerName: "Bhavesh Traders" } })).toEqual([{ kind: "owned", ownerName: "Bhavesh Traders" }]);
  });
});

describe("the scale and where a weight came from (FP-PK-02, D12)", () => {
  const stable = scaleView({ stable: true, grams: 52_400, configured: true, simulated: false, nodeId: "n" });
  const off = scaleView({ stable: false, configured: false, simulated: false, nodeId: null });
  const silent = scaleView({ stable: false, reason: "no_frames", configured: true, simulated: false, nodeId: "n" });
  const typed = { weight: "52.4", pieces: "21", override: false, lengthFields: { mm: "", feet: "", inches: "" }, po: "" };

  test("states: no scale, steady, silent", () => {
    expect(off.state).toBe("off");
    expect(stable).toEqual({ state: "stable", simulated: false, grams: 52_400 });
    expect(silent.state).toBe("silent");
    expect(typedWeightNeedsReason(off)).toBe(false);
    expect(typedWeightNeedsReason(stable)).toBe(true);
    expect(gramsToFieldText(52_400)).toBe("52.4");
  });

  test("before the scale has answered once, a typed weight asks its reason (m-10)", () => {
    expect(typedWeightNeedsReason(viewForReason(null))).toBe(true);
    expect(asksReason(viewForReason(null), 52_400, null)).toBe(true);
    const r = cardBundle({ key: "k", unit: "mm", typed, scale: viewForReason(null), filledFromG: null, lastStableG: null, reason: "" });
    expect(r.ok).toBe(false);
    // Once it has answered, the answer decides.
    expect(viewForReason(off)).toEqual(off);
    expect(typedWeightNeedsReason(viewForReason(off))).toBe(false);
    expect(viewForReason(stable)).toEqual(stable);
  });

  test("no scale on the node: nothing about provenance is sent and no reason is asked", () => {
    const r = cardBundle({ key: "k", unit: "mm", typed, scale: off, filledFromG: null, lastStableG: null, reason: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bundle.weightSource).toBeUndefined();
      expect(r.bundle.weightOverrideReason).toBeUndefined();
    }
  });

  test("a steady weight left as it filled the field is `scale`", () => {
    const r = cardBundle({ key: "k", unit: "mm", typed, scale: stable, filledFromG: 52_400, lastStableG: 52_400, reason: "" });
    expect(r.ok && r.bundle).toMatchObject({ weightSource: "scale", scaleReadingG: 52_400 });
    expect(weightProvenance({ weightG: 52_400, filledFromG: 52_400, lastStableG: 52_400 }).weightSource).toBe("scale");
  });

  test("a typed weight with a scale connected asks why, and carries the last steady reading as evidence", () => {
    const typedOver = { ...typed, weight: "52.1" };
    expect(cardBundle({ key: "k", unit: "mm", typed: typedOver, scale: stable, filledFromG: 52_400, lastStableG: 52_400, reason: "  " })).toEqual({ ok: false, errors: { reason: true } });
    const r = cardBundle({ key: "k", unit: "mm", typed: typedOver, scale: silent, filledFromG: null, lastStableG: 51_900, reason: " scale was off " });
    expect(r.ok && r.bundle).toMatchObject({ weightSource: "manual", scaleReadingG: 51_900, weightOverrideReason: "scale was off" });
    expect(asksReason(stable, 52_100, 52_400)).toBe(true);
    expect(asksReason(stable, 52_400, 52_400)).toBe(false);
    expect(asksReason(off, 52_100, null)).toBe(false);
  });

  test("field errors still come first, and typed bundles are counted for the review line", () => {
    const r = cardBundle({ key: "k", unit: "mm", typed: { ...typed, weight: "", pieces: "x" }, scale: stable, filledFromG: null, lastStableG: null, reason: "" });
    expect(r).toEqual({ ok: false, errors: { weight: true, pieces: true } });
    expect(typedCount([bundle({ weightSource: "manual" }), bundle({ key: "b", weightSource: "scale" }), bundle({ key: "c" })])).toBe(1);
  });
});

describe("server verdicts, not phone arithmetic (D15)", () => {
  test("a line is asked about only when weight, pieces and length are all real", () => {
    expect(previewReady({ dieId: "d", lengthMm: 3658, weightG: 52_400, pieces: 21 })).toBe(true);
    expect(previewReady({ dieId: null, lengthMm: 3658, weightG: 52_400, pieces: 21 })).toBe(false);
    expect(previewReady({ dieId: "d", lengthMm: 3658, weightG: null, pieces: 21 })).toBe(false);
    expect(previewReady({ dieId: "d", lengthMm: 0, weightG: 1, pieces: 1 })).toBe(false);
  });

  test("the band word comes from the server's position", () => {
    expect(positionKey("in")).toBe("status.range.inRange");
    expect(positionKey("below")).toBe("status.range.below");
    expect(positionKey("above")).toBe("status.range.above");
    expect(positionKey(null)).toBeNull();
  });

  test("the pack screens never call the local band maths for their chips", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["features/pack/bundles-step.tsx", "features/pack/review-step.tsx"]) {
      const src = readFileSync(join(import.meta.dir, "..", f), "utf8");
      expect(src).not.toMatch(/bundleReadout|rangeVerdict|kgPer12ft\(/);
      expect(src).toMatch(/useLinePreview|useLinesPreview/);
    }
  });
});

describe("a failed save, in the packer's language", () => {
  const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  const trpcError = (code: string, message: string, httpStatus = 400) => ({ data: { code, httpStatus }, message });

  test("kinds", () => {
    expect(saveErrorKind(new Error("Network request failed"))).toBe("unsure");
    expect(saveErrorKind(trpcError("INTERNAL_SERVER_ERROR", "x", 500))).toBe("unsure");
    expect(saveErrorKind(trpcError("FORBIDDEN", "This die belongs to Bhavesh Traders", 403))).toBe("owned");
    expect(saveErrorKind(trpcError("FORBIDDEN", "Nope", 403))).toBe("forbidden");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "Pick the cast these bundles came from"))).toBe("cast");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "Pick the die copy"))).toBe("copy");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "Row 2: say why the weight was typed instead of weighed"))).toBe("reason");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "Row 1: no scale is connected; type the weight and say why"))).toBe("scale");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "This line is pinned to 12170-2"))).toBe("pin");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "Pick the yard location for these bundles"))).toBe("yard");
    expect(saveErrorKind(trpcError("CONFLICT", "That order line changed meanwhile (closed, cancelled or removed). Pick the line again."))).toBe("order");
    expect(saveErrorKind(trpcError("BAD_REQUEST", "Something new"))).toBe("failed");
  });

  test("the text is ours: an unsure save says Save again is safe; the owner is named; the server's English is never shown", () => {
    expect(packSaveText(t as never, new Error("Network request failed"))).toMatchObject({ kind: "unsure", body: "pack.new.saveUnsure" });
    expect(packSaveText(t as never, trpcError("FORBIDDEN", "This die belongs to Bhavesh Traders", 403))).toMatchObject({ body: 'pack.dieOwned:{"name":"Bhavesh Traders"}' });
    const unknown = packSaveText(t as never, trpcError("BAD_REQUEST", "Some new English sentence"));
    expect(JSON.stringify(unknown)).not.toContain("Some new English sentence");
    // A sentence this build does not know still says something, in the person's language.
    expect(unknown).toMatchObject({ kind: "failed", body: "errors.generic" });
  });

  test("each refusal pattern matches its sample, maps to a kind the screen words, and the server still says it", () => {
    const sources = ["packages/server/src/routers/bundle.ts", "packages/server/src/lib/dieOwner.ts", "packages/server/src/routers/dieInstance.ts"].map(read).join("\n");
    expect(sources).toContain("This die belongs to");
    for (const r of PACK_REFUSALS) {
      expect({ sample: r.sample, hit: r.re.test(r.sample) }).toEqual({ sample: r.sample, hit: true });
      expect({ src: r.src, found: sources.includes(r.src) }).toEqual({ src: r.src, found: true });
      expect({ sample: r.sample, kind: saveErrorKind(trpcError("BAD_REQUEST", r.sample)) }).toEqual({ sample: r.sample, kind: r.kind });
    }
  });

  test("the same sentence under another tRPC code is not a known refusal", () => {
    expect(saveErrorKind(trpcError("INTERNAL_SERVER_ERROR", "Pick the die copy", 400))).toBe("failed");
  });

  test("every key the save text can use exists", () => {
    const keys = ["pack.new.saveCast", "pack.new.saveCopy", "pack.new.saveReason", "pack.new.saveScale", "pack.new.saveOrder", "pack.new.saveUnsure", "pack.new.saveFailed", "pack.new.forbidden", "pack.dieOwned", "pack.dieOwnedOther", "native.pack.savePin", "native.pack.saveRetired", "native.pack.yardRequired"];
    for (const k of keys) {
      const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], en);
      expect({ k, v: typeof v }).toEqual({ k, v: "string" });
    }
  });
});

describe("party numbers after the save (FP-PK-07)", () => {
  test("the range shows only when bundles carry a number of their own", () => {
    expect(partyRange([{ serial: "26J10", partyNo: "26J10" }])).toBeNull();
    expect(partyRange([{ serial: "26J10", partyNo: "4086" }, { serial: "26J11", partyNo: "4087" }])).toEqual({ from: "4086", to: "4087" });
    expect(partyNoLabel({ serial: "26J10", partyNo: "26J10" })).toBeNull();
    expect(partyNoLabel({ serial: "26J10", partyNo: "4086" })).toBe("4086");
  });
});
