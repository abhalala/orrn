import { describe, expect, test } from "bun:test";

import { ALLOY_LIMIT_SEEDS } from "@orrn/domain";

import {
  bpText,
  chooseCast,
  closeAdvice,
  closeBlock,
  closeFormIssue,
  countedBillets,
  countKey,
  lockState,
  lockedMeltTone,
  MELT_MORE_TIMES,
  MELT_PAIR,
  photoFits,
  PHOTO_QUALITIES,
  ppmPct,
  spectroInput,
  spectroRows,
  tailChip,
  verdictTone,
  billetCards,
  showsBillets,
  showsFoundryToday,
} from "../features/foundry/foundry-model";
import { MELT_TIME_KEYS } from "../features/foundry/melt-times";

describe("tone and chips", () => {
  test("verdict tones: a fail is red, a pass green, incomplete amber, none neutral", () => {
    expect([verdictTone("pass"), verdictTone("fail"), verdictTone("incomplete"), verdictTone(null)]).toEqual(["green", "red", "amber", "neutral"]);
  });

  test("a locked melt is green only with a pass and burn inside 3 %", () => {
    expect(lockedMeltTone({ verdict: "pass", lossBp: 286, warnings: [] })).toBe("green");
    expect(lockedMeltTone({ verdict: "pass", lossBp: 480, warnings: [{}] })).toBe("amber");
    expect(lockedMeltTone({ verdict: null, lossBp: 100, warnings: [] })).toBe("amber");
    expect(lockedMeltTone({ verdict: "fail", lossBp: 100, warnings: [] })).toBe("red");
  });

  test("the tail chip: balanced green, a tail amber, a tail needing approval or billets short red, nothing yet neutral", () => {
    const base = { producedG: 5_860_000, tailG: 0, shortG: 0, needsApproval: false, liveMelts: 1 };
    expect(tailChip(base)).toEqual({ tone: "green", kind: "balanced" });
    expect(tailChip({ ...base, tailG: 20_000 })).toEqual({ tone: "amber", kind: "tail" });
    expect(tailChip({ ...base, tailG: 400_000, needsApproval: true })).toEqual({ tone: "red", kind: "tail" });
    expect(tailChip({ ...base, shortG: 5_000, tailG: -5_000 })).toEqual({ tone: "red", kind: "short" });
    expect(tailChip({ producedG: 0, tailG: 0, shortG: 0, needsApproval: false, liveMelts: 0 })).toEqual({ tone: "neutral", kind: "empty" });
  });

  test("bpText and the ppm text", () => {
    expect(bpText(286)).toBe("2.9");
    expect(bpText(null)).toBe("");
    expect(ppmPct(4500)).toBe("0.450");
    expect(ppmPct(null)).toBe("-");
  });
});

describe("which cast the Cast tab shows", () => {
  const rows = [
    { id: "c3", number: "K33", status: "open" },
    { id: "c2", number: "K32", status: "closed" },
    { id: "c1", number: "K31", status: "open" },
  ];

  test("the newest open cast comes first; the person's own pick wins while it is still in the list", () => {
    expect(chooseCast(rows, null)).toBe("c3");
    expect(chooseCast(rows, "c1")).toBe("c1");
    expect(chooseCast(rows, "gone")).toBe("c3");
  });

  test("no open cast: the newest one, and an empty list is no cast at all", () => {
    expect(chooseCast([{ id: "x", status: "closed" }, { id: "y", status: "closed" }], null)).toBe("x");
    expect(chooseCast([], null)).toBeNull();
  });
});

describe("the melt sheet's times on a phone", () => {
  test("start and end are the big pair; the other three sit behind All times; together they are the five", () => {
    expect(MELT_PAIR).toEqual(["chargingStart", "castingEnd"]);
    expect([...MELT_PAIR, ...MELT_MORE_TIMES].sort()).toEqual([...MELT_TIME_KEYS].sort());
  });
});

describe("the lock button", () => {
  const base = { saved: true, dirty: false, gates: [] as string[], needsNewSample: false, spectroReason: "", pending: false };

  test("a saved draft with no gates locks", () => {
    expect(lockState(base)).toBe("ready");
  });

  test("an unsaved or changed draft is saved first, so the gates come from the server's preview", () => {
    expect(lockState({ ...base, saved: false })).toBe("save_first");
    expect(lockState({ ...base, dirty: true, gates: ["no_logs"] })).toBe("save_first");
  });

  test("any gate the server names holds the lock, one this build does not know included", () => {
    expect(lockState({ ...base, gates: ["no_logs"] })).toBe("gated");
    expect(lockState({ ...base, gates: ["mystery"] })).toBe("gated");
  });

  test("a stale spectro asks for a new sample or a written reason", () => {
    expect(lockState({ ...base, needsNewSample: true })).toBe("needs_reason");
    expect(lockState({ ...base, needsNewSample: true, spectroReason: " " })).toBe("needs_reason");
    expect(lockState({ ...base, needsNewSample: true, spectroReason: "sample lost" })).toBe("ready");
  });

  test("while the gates are loading the button waits", () => {
    expect(lockState({ ...base, pending: true })).toBe("loading");
  });
});

describe("the closer's count", () => {
  test("pieces and kg become a count; zero and zero is a real count", () => {
    expect(countedBillets("48", "5860")).toEqual({ ok: true, billetsOnHand: { count: 48, kgG: 5_860_000 } });
    expect(countedBillets("0", "0")).toEqual({ ok: true, billetsOnHand: { count: 0, kgG: 0 } });
  });

  test("a blank, a word or a half count is named", () => {
    expect(countedBillets("", "10")).toEqual({ ok: false, issue: "pcs" });
    expect(countedBillets("4", "")).toEqual({ ok: false, issue: "kg" });
    expect(countedBillets("0", "12")).toEqual({ ok: false, issue: "together" });
  });

  test("one key per valid count", () => {
    expect(countKey(countedBillets("4", "98"))).toBe("4:98000");
    expect(countKey(countedBillets("", "98"))).toBe("");
  });

  test("a draft melt blocks the close; a closed cast cannot be closed again", () => {
    expect(closeBlock("open", { draftMelts: 1 })).toBe("draft_melts");
    expect(closeBlock("open", { draftMelts: 0 })).toBeNull();
    expect(closeBlock("closing", { draftMelts: 0 })).toBe("not_open");
  });

  test("a reason is asked only when the tail needs one, and 'other' needs a note", () => {
    const reasons = [{ code: "scale_difference", requiresNote: false }, { code: "other", requiresNote: true }];
    expect(closeFormIssue({ needsReason: false }, { reasonCode: "", note: "" }, reasons)).toBeNull();
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "", note: "" }, reasons)).toBe("reason");
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "other", note: " " }, reasons)).toBe("note");
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "other", note: "pit spill" }, reasons)).toBeNull();
  });
});

describe("the close sheet's chip comes from the server's closePreview", () => {
  const preview = { tailG: 0, shortG: 0, needsReason: false, needsApproval: false };

  test("a count that matches the ledger is green: no reason, no approval", () => {
    expect(closeAdvice(preview)).toEqual({ tone: "green", reasonRequired: false, approval: false });
  });

  test("a tail the server wants a reason for is amber and requires the reason", () => {
    expect(closeAdvice({ ...preview, tailG: 20_000, needsReason: true })).toEqual({ tone: "amber", reasonRequired: true, approval: false });
  });

  test("a big tail or billets short needs a second person, and the sheet says so", () => {
    expect(closeAdvice({ ...preview, tailG: 400_000, needsReason: true, needsApproval: true })).toEqual({ tone: "amber", reasonRequired: true, approval: true });
    expect(closeAdvice({ ...preview, shortG: 5_000, tailG: -5_000, needsReason: true, needsApproval: true })?.tone).toBe("amber");
  });

  test("no preview yet is no advice, and never a reason the server did not ask for", () => {
    expect(closeAdvice(undefined)).toBeNull();
  });
});

describe("billet stock cards", () => {
  test("one card per cast with kg on hand, grouped by the server's alloy order; finished casts last", () => {
    const stock = {
      casts: [
        { castId: "a", number: "K31", alloy: "6063", status: "open", onHandG: 1_200_000, adjustedG: 0 },
        { castId: "b", number: "K30", alloy: "6063", status: "closed", onHandG: 0, adjustedG: 0 },
        { castId: "c", number: "K29", alloy: "6061", status: "open", onHandG: 300_000, adjustedG: 5_000 },
      ],
      byAlloy: [
        { alloy: "6063", casts: 2, onHandG: 1_200_000 },
        { alloy: "6061", casts: 1, onHandG: 300_000 },
      ],
      totalG: 1_500_000,
      adjustedG: 5_000,
    };
    const cards = billetCards(stock);
    expect(cards.groups.map((g) => g.alloy)).toEqual(["6063", "6061"]);
    expect(cards.groups[0]!.casts.map((c) => c.number)).toEqual(["K31"]);
    expect(cards.finished.map((c) => c.number)).toEqual(["K30"]);
    expect(cards.totalG).toBe(1_500_000);
  });

  test("no stock yet is no cards", () => {
    expect(billetCards(undefined)).toEqual({ groups: [], finished: [], totalG: 0 });
  });
});

describe("spectro photo", () => {
  test("a photo fits when its base64 is under the server's 1 MB cap; three qualities are tried, best first", () => {
    expect(photoFits("a".repeat(999_999))).toBe(true);
    expect(photoFits("a".repeat(1_000_001))).toBe(false);
    expect(photoFits("")).toBe(false);
    expect([...PHOTO_QUALITIES]).toEqual([...PHOTO_QUALITIES].sort((x, y) => y - x));
    expect(PHOTO_QUALITIES.length).toBe(3);
  });
});

describe("spectro rows and typed entry", () => {
  const limits = ALLOY_LIMIT_SEEDS["6063"];
  const pass = { si: 0.42, fe: 0.18, cu: 0.02, mn: 0.03, mg: 0.52, zn: 0.01, ti: 0.02, cr: 0.01 };

  test("a result inside the 6063 limits passes, with Al as the balance", () => {
    const r = spectroRows(pass, limits)!;
    expect(r.verdict).toBe("pass");
    expect(r.rows.find((x) => x.element === "al")!.source).toBe("balance");
  });

  test("iron above 0.35 fails and says which element", () => {
    const r = spectroRows({ ...pass, fe: 0.41 }, limits)!;
    expect(r.rows.filter((x) => x.reading === "fail").map((x) => x.element)).toEqual(["fe"]);
  });

  test("percent text becomes whole ppm, blank elements are skipped; nothing, junk and over 100 % are refused", () => {
    expect(spectroInput({ si: "0.42", mg: "0,52", fe: "" })).toEqual({ ok: true, valuesPpm: { si: 4200, mg: 5200 } });
    expect(spectroInput({})).toEqual({ ok: false, element: "si", reason: "none" });
    expect(spectroInput({ si: "0.42", fe: "abc" })).toEqual({ ok: false, element: "fe", reason: "invalid" });
    expect(spectroInput({ si: "60", fe: "50" })).toEqual({ ok: false, element: "si", reason: "over" });
  });
});

describe("who sees the foundry on Stock and Today", () => {
  const me = (role: string, modules: string[] = []) =>
    ({ user: { id: "u", name: "A", email: "a@b.in" }, company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules }, isPlatformAdmin: false }) as never;

  test("Billets on Stock: the foundry floor and the people who open or close casts, never a packer", () => {
    expect(showsBillets(me("foundry"))).toBe(true);
    expect(showsBillets(me("supervisor"))).toBe(true);
    expect(showsBillets(me("manager"))).toBe(true);
    expect(showsBillets(me("packer"))).toBe(false);
    expect(showsBillets(me("viewer"))).toBe(false);
    expect(showsBillets(null)).toBe(false);
  });

  test("a plant without the foundry module sees neither the Billets section nor the Foundry tile", () => {
    expect(showsBillets(me("foundry", ["bundles", "dies"]))).toBe(false);
    expect(showsFoundryToday(me("foundry", ["bundles"]))).toBe(false);
    expect(showsFoundryToday(me("foundry", ["foundry"]))).toBe(true);
  });

  test("the Foundry tile on Today is for cast.enter holders: foundry and supervisor, not manager or packer", () => {
    expect(showsFoundryToday(me("foundry"))).toBe(true);
    expect(showsFoundryToday(me("supervisor"))).toBe(true);
    expect(showsFoundryToday(me("manager"))).toBe(false);
    expect(showsFoundryToday(me("packer"))).toBe(false);
  });
});
