import { describe, expect, test } from "bun:test";

import {
  admErrorKey,
  bankPayload,
  bankProblems,
  docFileKind,
  docMimeFor,
  docPayload,
  docProblems,
  draftFromRule,
  EMPTY_BANK,
  EMPTY_DOC,
  EMPTY_TOOLING,
  fileSizeText,
  formatFromDraft,
  formatProblem,
  fyPeriod,
  insuranceProblems,
  insuranceState,
  limitPercentText,
  matchesBuiltIn,
  minStockFromText,
  parseLimitPercent,
  previewNumber,
  ruleInput,
  ruleProblem,
  sameFormat,
  seqFromNext,
  toggleRole,
  toolingCreatePayload,
  toolingProblems,
  toolingStatusTone,
} from "./adm-model";
import { parseListsSearch, parseRulesSearch } from "./adm-search";
import { masterEntries } from "./masters-model";

describe("number formats", () => {
  test("financial year runs April to March", () => {
    expect(fyPeriod("2026-11-22")).toBe("2026-27");
    expect(fyPeriod("2027-03-31")).toBe("2026-27");
    expect(fyPeriod("2027-04-01")).toBe("2027-28");
    expect(fyPeriod("nope")).toBe("");
  });
  test("the count is read from the end of a number", () => {
    expect(seqFromNext("PL/2026-27/12")).toBe(12);
    expect(seqFromNext("SO-7")).toBe(7);
    expect(seqFromNext("FC/26-27/0012")).toBe(12);
    expect(seqFromNext("none")).toBeNull();
  });
  test("preview follows prefix, year and padding", () => {
    expect(previewNumber({ prefix: "FC/SO/", fy: "short", pad: 4 }, "2026-27", 12)).toBe("FC/SO/26-27/0012");
    expect(previewNumber({ prefix: "SO-", fy: "none", pad: 0 }, "2026-27", 5)).toBe("SO-5");
    expect(previewNumber({ prefix: "PL/", fy: "long", pad: 0 }, "2026-27", 3)).toBe("PL/2026-27/3");
  });
  test("a draft is checked like the server checks it", () => {
    const ok = { prefix: "SO-", fy: "none" as const, pad: "0" };
    expect(formatProblem("so", ok)).toBeNull();
    expect(formatProblem("so", { ...ok, prefix: "SO1" })).toBe("adm.masters.rules.formats.problem.prefixChars");
    expect(formatProblem("so", { ...ok, prefix: "ABCDEFGHIJKLM" })).toBe("adm.masters.rules.formats.problem.prefixLength");
    expect(formatProblem("so", { ...ok, pad: "9" })).toBe("adm.masters.rules.formats.problem.pad");
    expect(formatProblem("so", { ...ok, pad: "x" })).toBe("adm.masters.rules.formats.problem.pad");
    expect(formatProblem("pl", { prefix: "PL/", fy: "none", pad: "0" })).toBe("adm.masters.rules.formats.problem.yearRequired");
    expect(formatProblem("pl", { prefix: "PL/", fy: "long", pad: "0" })).toBeNull();
  });
  test("draft to format and comparison", () => {
    expect(formatFromDraft({ prefix: " X- ", fy: "long", pad: "3" })).toEqual({ prefix: "X-", fy: "long", pad: 3 });
    expect(formatFromDraft({ prefix: "X", fy: "none", pad: "" })).toBeNull();
    expect(sameFormat({ prefix: "A", fy: "none", pad: 0 }, { prefix: "A", fy: "none", pad: 0 })).toBe(true);
    expect(sameFormat({ prefix: "A", fy: "none", pad: 0 }, { prefix: "A", fy: "long", pad: 0 })).toBe(false);
  });
});

describe("approval rules", () => {
  test("threshold percent: 200 basis points is 2%", () => {
    expect(limitPercentText(200)).toBe("2");
    expect(limitPercentText(250)).toBe("2.5");
    expect(limitPercentText(null)).toBe("");
    expect(parseLimitPercent("2")).toEqual({ ok: true, value: 200 });
    expect(parseLimitPercent("2.5")).toEqual({ ok: true, value: 250 });
    expect(parseLimitPercent("")).toEqual({ ok: true, value: null });
    expect(parseLimitPercent("101")).toEqual({ ok: false });
    expect(parseLimitPercent("1.234")).toEqual({ ok: false });
  });
  test("the owner is always put first and never a checkbox", () => {
    const draft = draftFromRule(null, ["owner", "manager"]);
    expect(draft.roles).toEqual(["manager"]);
    expect(ruleInput({ roles: ["manager"], above: null })).toEqual({ roles: ["owner", "manager"] });
    expect(ruleInput({ roles: [], above: null })).toEqual({ roles: ["owner"] });
    expect(ruleInput({ roles: ["manager"], above: { value: 200, roles: ["admin"] } })).toEqual({
      roles: ["owner", "manager"],
      above: { value: 200, roles: ["owner", "admin"] },
    });
  });
  test("a limit with no figure is refused; no limit sends none", () => {
    expect(ruleProblem({ roles: [], above: { value: null, roles: [] } })).toBe("limit");
    expect(ruleProblem({ roles: [], above: { value: 0, roles: [] } })).toBeNull();
    expect(ruleInput({ roles: ["office"], above: { value: null, roles: [] } })).toEqual({ roles: ["owner", "office"] });
  });
  test("toggling roles and matching the built-in approvers", () => {
    expect(toggleRole(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleRole(["a", "b"], "a")).toEqual(["b"]);
    expect(matchesBuiltIn({ roles: ["manager"], above: null }, ["owner", "manager"])).toBe(true);
    expect(matchesBuiltIn({ roles: ["manager", "office"], above: null }, ["owner", "manager"])).toBe(false);
    expect(matchesBuiltIn({ roles: ["manager"], above: { value: 1, roles: [] } }, ["manager"])).toBe(false);
  });
});

describe("bank accounts", () => {
  const good = { ...EMPTY_BANK, bankName: "State Bank", accountName: "Four Cubes", accountNo: "1234 5678 90", ifsc: "sbin0001234" };
  test("checks the account number and the bank code", () => {
    expect(bankProblems(good)).toEqual({});
    expect(Object.keys(bankProblems(EMPTY_BANK)).sort()).toEqual(["accountName", "accountNo", "bankName", "ifsc"]);
    expect(bankProblems({ ...good, accountNo: "12345" }).accountNo).toBeDefined();
    expect(bankProblems({ ...good, ifsc: "SBIN1001234" }).ifsc).toBeDefined();
  });
  test("payload drops spaces and upper-cases the code", () => {
    const p = bankPayload(good);
    expect(p.accountNo).toBe("1234567890");
    expect(p.ifsc).toBe("SBIN0001234");
    expect(p.branch).toBeNull();
  });
});

describe("transit insurance", () => {
  test("needs a policy and insurer; the end may not precede the start", () => {
    expect(Object.keys(insuranceProblems({ policyNo: "", insurer: "", validFrom: "", validTo: "", printOnPl: true })).sort()).toEqual(["insurer", "policyNo"]);
    expect(insuranceProblems({ policyNo: "P1", insurer: "I", validFrom: "2026-05-01", validTo: "2026-04-01", printOnPl: true }).validTo).toBeDefined();
    expect(insuranceProblems({ policyNo: "P1", insurer: "I", validFrom: "", validTo: "", printOnPl: false })).toEqual({});
  });
  test("where the policy stands today", () => {
    expect(insuranceState(null, "2026-11-22")).toBe("none");
    expect(insuranceState({ validFrom: null, validTo: null }, "2026-11-22")).toBe("open");
    expect(insuranceState({ validFrom: "2026-12-01", validTo: null }, "2026-11-22")).toBe("notStarted");
    expect(insuranceState({ validFrom: null, validTo: "2026-11-21" }, "2026-11-22")).toBe("expired");
    expect(insuranceState({ validFrom: null, validTo: "2026-12-10" }, "2026-11-22")).toBe("soon");
    expect(insuranceState({ validFrom: null, validTo: "2027-06-30" }, "2026-11-22")).toBe("valid");
  });
});

describe("documents and files", () => {
  test("title is required; payload blanks become null", () => {
    expect(docProblems(EMPTY_DOC).title).toBeDefined();
    expect(docProblems({ ...EMPTY_DOC, title: "Packing SOP" })).toEqual({});
    expect(docPayload({ ...EMPTY_DOC, title: " SOP ", version: " ", reviewOn: "" })).toEqual({ title: "SOP", kind: "procedure", version: null, reviewOn: null, notes: null });
  });
  test("file kind by name and type", () => {
    expect(docFileKind({ name: "a.PDF", type: "" })).toBe("pdf");
    expect(docFileKind({ name: "a.cdr", type: "" })).toBe("cdr");
    expect(docFileKind({ name: "a.dwg", type: "" })).toBe("dwg");
    expect(docFileKind({ name: "a.jpg", type: "image/jpeg" })).toBe("image");
    expect(docFileKind({ name: "a.xlsx", type: "" })).toBeNull();
    expect(docMimeFor("pdf", { name: "a.pdf", type: "" })).toBe("application/pdf");
    expect(docMimeFor("dwg", { name: "a.dwg", type: "" })).toBe("");
    expect(docMimeFor("image", { name: "a.png", type: "" })).toBe("image/png");
  });
  test("sizes read plainly", () => {
    expect(fileSizeText(500)).toBe("500 B");
    expect(fileSizeText(2048)).toBe("2 KB");
    expect(fileSizeText(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("tooling", () => {
  test("a piece needs its mark; payload trims", () => {
    expect(toolingProblems(EMPTY_TOOLING).code).toBeDefined();
    expect(toolingCreatePayload({ ...EMPTY_TOOLING, code: " B-12 ", size: "240 x 90" })).toMatchObject({ code: "B-12", size: "240 x 90", location: null, status: "awaiting_inspection" });
  });
  test("tones", () => {
    expect(toolingStatusTone("failed")).toBe("red");
    expect(toolingStatusTone("in_store")).toBeNull();
    expect(toolingStatusTone("retired")).toBe("neutral");
  });
  test("least to keep: blanks and zeros drop, junk refuses", () => {
    expect(minStockFromText({ bolster: "3", backer: "", liner: "0" })).toEqual({ bolster: 3 });
    expect(minStockFromText({ bolster: "x" })).toBeNull();
    expect(minStockFromText({ bolster: "1000" })).toBeNull();
  });
});

describe("server refusals", () => {
  test("known sentences become keys; others fall back", () => {
    expect(admErrorKey(new Error('"Fitter" is already on this list'))).toEqual({ key: "adm.masters.errors.nameTaken", vars: { name: "Fitter" } });
    expect(admErrorKey(new Error("B-1 is already a tooling piece here"))).toEqual({ key: "adm.masters.errors.toolingCodeTaken", vars: { code: "B-1" } });
    expect(admErrorKey(Object.assign(new Error("x"), { data: { code: "PRECONDITION_FAILED" } })).key).toBe("adm.masters.documents.errors.noStorage");
    expect(admErrorKey(new Error("something odd")).key).toBe("masters.errors.generic");
  });
});

describe("routes and hub", () => {
  test("search parsers keep clean URLs", () => {
    expect(parseListsSearch({ kind: "die_category" })).toEqual({ kind: "die_category" });
    expect(parseListsSearch({ kind: "department" })).toEqual({});
    expect(parseListsSearch({ kind: "zzz" })).toEqual({});
    expect(parseRulesSearch({ tab: "insurance" })).toEqual({ tab: "insurance" });
    expect(parseRulesSearch({ tab: "formats" })).toEqual({});
  });
  test("plant group entries follow the roles", () => {
    const owner = { company: { role: "owner" }, isPlatformAdmin: false, platformRole: null } as never;
    const packer = { company: { role: "packer" }, isPlatformAdmin: false, platformRole: null } as never;
    const keys = (m: never) => masterEntries(m).filter((e) => e.group === "plant").map((e) => e.key);
    expect(keys(owner)).toEqual(["plantLists", "bank", "rules", "documents", "tooling"]);
    expect(keys(packer)).toEqual(["plantLists", "documents", "tooling"]);
  });
});
