import { describe, expect, test } from "bun:test";
import { editDistance, fold, matchItem, rankItems, TIER, type Searchable } from "./search";

const page = (id: string, label: string, extra: Partial<Searchable> = {}): Searchable => ({
  id,
  group: "pages",
  label,
  ...extra,
});

const dispatch = page("dispatch", "Dispatch", { aliases: ["challan", "PL", "packing list", "चालान"] });
const dies = page("dies", "Dies", { aliases: ["matrix", "bolster", "डाई", "ડાઈ"] });
const masters = page("masters", "Masters", { terms: ["Alloys", "Vendors", "Scrap"] });
const foundry = page("foundry", "Foundry", { aliases: ["furnace", "melt", "भट्टी"] });
const ITEMS = [dispatch, dies, masters, foundry];

describe("fold", () => {
  test("case, accents and punctuation", () => {
    expect(fold("  Café-Déjà_vu!! ")).toBe("cafe deja vu");
    expect(fold("Melt / Times")).toBe("melt times");
  });
  test("keeps Indic vowel signs (folded to their short form, never dropped)", () => {
    expect(fold("डाई")).toBe("डाइ");
    expect(fold("ભઠ્ઠી")).toBe("ભઠ્ઠિ");
    expect(fold("डाइ")).toHaveLength(3);
  });
  test("Hindi and Gujarati: long and short vowels, nukta and candrabindu fold together (review S2)", () => {
    expect(fold("डाई")).toBe(fold("डाइ"));
    expect(fold("मंज़ूरी")).toBe(fold("मंजुरि"));
    expect(fold("मंज़ूरी")).toBe(fold("मंजूरी"));
    expect(fold("ऊपर")).toBe(fold("उपर"));
    expect(fold("ईंट")).toBe(fold("इंट"));
    expect(fold("माँग")).toBe(fold("मांग"));
    // Precomposed nukta letters (U+0958..U+095F) decompose and lose the nukta too.
    expect(fold("\u095B")).toBe(fold("ज"));
    expect(fold("ડાઈ")).toBe(fold("ડાઇ"));
    expect(fold("મંજૂરી")).toBe(fold("મંજુરિ"));
    expect(fold("ઊંચું")).toBe(fold("ઉંચું"));
    expect(fold("જ઼")).toBe(fold("જ"));
    expect(fold("ઁ")).toBe(fold("ં"));
  });
  test("folding keeps different words apart", () => {
    // Different consonants and different vowels stay different.
    expect(fold("डाई")).not.toBe(fold("डिवाइस"));
    expect(fold("दिन")).not.toBe(fold("दान"));
    expect(fold("कम")).not.toBe(fold("काम"));
  });
});

describe("editDistance", () => {
  test("counts edits and swaps", () => {
    expect(editDistance("dispach", "dispatch", 2)).toBe(1);
    expect(editDistance("dsipatch", "dispatch", 2)).toBe(1);
    expect(editDistance("abc", "abc", 1)).toBe(0);
  });
  test("stops past the bound", () => {
    expect(editDistance("abcdef", "uvwxyz", 1)).toBe(2);
  });
});

describe("matchItem tiers", () => {
  test("empty query matches with score 0", () => {
    expect(matchItem("   ", dispatch)).toEqual({ score: 0 });
  });
  test("exact > prefix > word-prefix > substring > subsequence > typo", () => {
    const item = page("x", "Melt times");
    const exact = matchItem("melt times", item)!.score;
    const prefix = matchItem("melt t", item)!.score;
    const wordPrefix = matchItem("tim", item)!.score;
    const substring = matchItem("elt tim", item)!.score;
    const subseq = matchItem("mtt", item)!.score;
    // A swap in the middle of a 6-letter word (4 and 5 letter words only take slips at the end, review S1).
    const typo = matchItem("mletxy", page("y", "Meltxy bay"))!.score;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(typo);
    expect(exact).toBeGreaterThanOrEqual(TIER.exact);
    expect(typo).toBeLessThan(TIER.subsequence);
  });
  test("case and accent insensitive", () => {
    expect(matchItem("DISPATCH", dispatch)).not.toBeNull();
    expect(matchItem("dïspätch", dispatch)).not.toBeNull();
  });
  test("subsequence: dsp finds Dispatch", () => {
    const m = matchItem("dsp", dispatch);
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(TIER.subsequence);
    expect(m!.score).toBeLessThan(TIER.substring);
  });
  test("subsequence must start at a word start", () => {
    expect(matchItem("pc", page("z", "Dispatch"))).toBeNull(); // p..c in order, but p starts no word
  });
});

describe("typos", () => {
  test("one edit for words of 4+ letters", () => {
    expect(matchItem("dispach", dispatch)).not.toBeNull();
    expect(matchItem("mastrs", masters)).not.toBeNull();
    expect(matchItem("fondry", foundry)).not.toBeNull();
  });
  test("adjacent swap counts as one edit", () => {
    expect(matchItem("dsipatch", dispatch)).not.toBeNull();
  });
  test("no typo allowance under 4 letters", () => {
    expect(matchItem("dix", dies)).toBeNull();
  });
  test("two edits only for 8+ letters", () => {
    expect(matchItem("dsipacth", dispatch)).not.toBeNull(); // 8 letters, two swaps
    expect(matchItem("mstrz", masters)).toBeNull(); // 5 letters, more than one edit
  });
  test("typo while still typing the word", () => {
    expect(matchItem("dispq", page("p", "Dispatches today"))).not.toBeNull();
    expect(matchItem("dispq", dispatch)).not.toBeNull();
    expect(matchItem("dispatc", dispatch)).not.toBeNull();
  });
});

describe("typo false positives on 4 and 5 letter words (review S1)", () => {
  const customers = page("customers", "Customers", { aliases: ["party", "client", "buyer"] });
  const pack = page("pack", "Pack", { aliases: ["packing", "label", "sticker"] });
  const stock = page("stock", "Stock", { aliases: ["section", "profile"] });
  const bundles: Searchable = { id: "stock.bundles", group: "sections", label: "Stock bundles", terms: ["serial", "bundle list"] };
  const ovens: Searchable = { id: "masters.ovens", group: "sections", label: "Ovens", terms: ["oven", "temperature"] };
  const users: Searchable = { id: "settings.team", group: "sections", label: "Team", terms: ["users", "members"] };

  test("cast does not bring up Customers or Masters", () => {
    expect(matchItem("cast", customers)).toBeNull();
    expect(matchItem("cast", page("masters", "Masters"))).toBeNull();
  });
  test("stock does not match sticker", () => {
    expect(matchItem("stock", pack)).toBeNull();
    expect(rankItems("stock", [pack, stock]).map((r) => r.id)).toEqual(["stock"]);
  });
  test("dies does not bring up Dispatch; user does not match serial; team does not match temperature", () => {
    expect(matchItem("dies", dispatch)).toBeNull();
    expect(matchItem("user", bundles)).toBeNull();
    expect(matchItem("team", ovens)).toBeNull();
    expect(matchItem("user", users)).not.toBeNull(); // the real word still matches
  });
  test("a one-vowel slip in Hindi does not match a different word (QA N3)", () => {
    const hiPack = page("pack", "पैकिंग", { aliases: ["स्टिकर"] });
    expect(matchItem("स्टॉक", hiPack)).toBeNull();
  });
  test("a short word with its last letter changed into another whole word does not match", () => {
    expect(matchItem("data", page("d", "Ship date"))).toBeNull();
    expect(matchItem("held", page("h", "Help"))).toBeNull();
    expect(matchItem("line", page("l", "Die life"))).toBeNull();
    expect(matchItem("late", page("p", "Print", { aliases: ["label"] }))).toBeNull();
  });
  test("a short word's slip never matches a term", () => {
    expect(matchItem("copx", { id: "s", group: "sections", label: "Die life", terms: ["retired copies"] })).toBeNull();
  });
  test("real typos of short words still match", () => {
    expect(matchItem("stokc", stock)).not.toBeNull(); // swapped last two letters
    expect(matchItem("dispq", dispatch)).not.toBeNull(); // last letter wrong while typing
    expect(matchItem("custo", customers)).not.toBeNull(); // plain prefix
    expect(matchItem("custm", customers)).not.toBeNull(); // last letter wrong while typing
  });
});

describe("aliases and matched word", () => {
  test("English plant word finds the page and reports it", () => {
    expect(matchItem("challan", dispatch)).toEqual({ score: TIER.exact + 20, matched: "challan" });
    expect(matchItem("packing", dispatch)?.matched).toBe("packing list");
  });
  test("Hindi alias", () => {
    expect(matchItem("चालान", dispatch)?.matched).toBe("चालान");
    expect(matchItem("भट्टी", foundry)?.matched).toBe("भट्टी");
  });
  test("Gujarati alias", () => {
    expect(matchItem("ડાઈ", dies)?.matched).toBe("ડાઈ");
  });
  test("terms report the matched word", () => {
    expect(matchItem("alloy", masters)?.matched).toBe("Alloys");
  });
  test("label hits carry no matched word", () => {
    expect(matchItem("disp", dispatch)?.matched).toBeUndefined();
  });
  test("English label matched when the UI is Hindi, with no matched word", () => {
    const hi = page("dispatch", "डिस्पैच", { labelEn: "Dispatch" });
    const m = matchItem("dispatch", hi);
    expect(m).not.toBeNull();
    expect(m!.matched).toBeUndefined();
    expect(matchItem("डिस्पैच", hi)).not.toBeNull();
  });
  test("label beats an alias in the same tier", () => {
    const a = page("a", "Melt", {});
    const b = page("b", "Foundry", { aliases: ["melt"] });
    expect(rankItems("melt", [b, a]).map((r) => r.id)).toEqual(["a", "b"]);
  });
  test("query words spread over label and terms", () => {
    const s: Searchable = { id: "dies.makers", group: "sections", label: "Makers", terms: ["dies", "die maker"] };
    const m = matchItem("dies makers", s);
    expect(m).not.toBeNull();
  });
});

describe("rankItems", () => {
  test("empty query keeps every item in order", () => {
    expect(rankItems("", ITEMS).map((r) => r.id)).toEqual(["dispatch", "dies", "masters", "foundry"]);
  });
  test("a query of only punctuation matches nothing (review M1)", () => {
    for (const q of ["-", "#", "/", ">", "--", " . "]) {
      expect(rankItems(q, ITEMS)).toEqual([]);
      expect(matchItem(q, dispatch)).toBeNull();
    }
    expect(rankItems("   ", ITEMS)).toHaveLength(ITEMS.length);
  });
  test("drops non-matches and ranks best first", () => {
    const r = rankItems("di", ITEMS);
    expect(r.map((x) => x.id)).toEqual(["dies", "dispatch"]);
  });
  test("tie-break: shorter label, then group order, then input order", () => {
    const long = page("long", "Stock lengths");
    const short = page("short", "Stock");
    expect(rankItems("stock", [long, short]).map((r) => r.id)).toEqual(["short", "long"]);

    const cmd: Searchable = { id: "cmd", group: "commands", label: "Print" };
    const sec: Searchable = { id: "sec", group: "sections", label: "Print" };
    const rec: Searchable = { id: "rec", group: "recent", label: "Print" };
    expect(rankItems("print", [sec, cmd, rec]).map((r) => r.id)).toEqual(["rec", "cmd", "sec"]);

    const p1 = page("p1", "Print");
    const p2 = page("p2", "Print");
    expect(rankItems("print", [p2, p1]).map((r) => r.id)).toEqual(["p2", "p1"]);
  });
  test("exact beats typo even when the typo item comes first", () => {
    const typo = page("typo", "Diest");
    const exact = page("exact", "Dies");
    expect(rankItems("dies", [typo, exact])[0]!.id).toBe("exact");
  });
  test("keeps item fields and adds match", () => {
    const [r] = rankItems("challan", [dispatch]);
    expect(r!.label).toBe("Dispatch");
    expect(r!.match.matched).toBe("challan");
  });
  test("a few hundred items per keystroke stay fast", () => {
    const many: Searchable[] = [];
    for (let i = 0; i < 400; i++) {
      many.push(page(`p${i}`, `Page number ${i}`, { aliases: ["challan", "scrap", "billet"], terms: ["melt times", "alloys"] }));
    }
    rankItems("x", many); // warm the cache
    const start = performance.now();
    for (const q of ["d", "di", "dis", "disp", "dispa", "dispat", "dispatc", "dispatch"]) rankItems(q, many);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
