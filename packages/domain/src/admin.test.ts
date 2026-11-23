import { describe, expect, test } from "bun:test";

import {
  APPROVAL_MEASURES,
  approverRolesFor,
  bankPrintParts,
  checkApprovalRule,
  checkDocFormat,
  DEFAULT_DOC_FORMATS,
  dieCostPerKgPaise,
  documentReviewDue,
  effectiveDocFormat,
  FORMATTABLE_DOC_TYPES,
  formatDocNumberWith,
  insuranceForPl,
  isBankAccountNo,
  isIfsc,
  possibleApproverRoles,
  readApprovalRules,
  readDocFormats,
  readToolingMinStock,
  readTransitInsurance,
  toolingShortfalls,
  type DocFormat,
} from "./admin";

const ROLES = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];

describe("number formats (#77)", () => {
  test("the defaults print today's numbers", () => {
    expect(formatDocNumberWith(DEFAULT_DOC_FORMATS.so, "2026-27", 12)).toBe("SO-12");
    expect(formatDocNumberWith(DEFAULT_DOC_FORMATS.pl, "2026-27", 12)).toBe("PL/2026-27/12");
    expect(formatDocNumberWith(DEFAULT_DOC_FORMATS.cert, "2026-27", 3)).toBe("TC/2026-27/3");
    expect(formatDocNumberWith(DEFAULT_DOC_FORMATS.press_run, "2026-27", 7)).toBe("PR-7");
    expect(effectiveDocFormat("grn", {})).toEqual(DEFAULT_DOC_FORMATS.grn);
  });

  test("prefix, short or long year and padding", () => {
    expect(formatDocNumberWith({ prefix: "FC/SO/", fy: "short", pad: 4 }, "2026-27", 12)).toBe("FC/SO/26-27/0012");
    expect(formatDocNumberWith({ prefix: "SO-", fy: "long", pad: 3 }, "2026-27", 1234)).toBe("SO-2026-27/1234");
    expect(formatDocNumberWith({ prefix: "", fy: "none", pad: 0 }, "2026-27", 5)).toBe("5");
  });

  test("checks: no digits in the prefix, padding range, year required where the number is unique across years", () => {
    expect(checkDocFormat("so", { prefix: "SO1-", fy: "none", pad: 0 })).toBe("prefix_chars");
    expect(checkDocFormat("so", { prefix: "S O", fy: "none", pad: 0 })).toBe("prefix_chars");
    expect(checkDocFormat("so", { prefix: "ABCDEFGHIJKLM", fy: "none", pad: 0 })).toBe("prefix_length");
    expect(checkDocFormat("so", { prefix: "SO-", fy: "none", pad: 9 })).toBe("pad_range");
    expect(checkDocFormat("so", { prefix: "SO-", fy: "weird" as never, pad: 0 })).toBe("fy_style");
    expect(checkDocFormat("ageing", { prefix: "AG-", fy: "none", pad: 0 })).toBe("fy_required");
    expect(checkDocFormat("pl", { prefix: "PL-", fy: "none", pad: 0 })).toBe("fy_required");
    expect(checkDocFormat("bundle", { prefix: "B-", fy: "none", pad: 0 })).toBe("unknown_type");
    // Today's AG-{n} has no year although ageing_batch.number is unique across years (a repeat on
    // 1 April would be refused by the index); a format the plant sets must carry the year.
    for (const t of FORMATTABLE_DOC_TYPES) expect(checkDocFormat(t, DEFAULT_DOC_FORMATS[t])).toBe(t === "ageing" ? "fy_required" : null);
  });

  test("reading the stored formats drops bad entries (they print as today)", () => {
    const formats = readDocFormats({ so: { prefix: "S/", fy: "short", pad: 3 }, grn: { prefix: "G1", fy: "none", pad: 0 }, bundle: { prefix: "B", fy: "none", pad: 0 } });
    expect(formats).toEqual({ so: { prefix: "S/", fy: "short", pad: 3 } });
    expect(readDocFormats(null)).toEqual({});
  });

  /**
   * The counter only goes up within a period and restarts at 1 in the next period; formats may
   * change at any point in between. Every number printed in one year must differ from every other
   * printed in that year, and the restart must give 1 again.
   */
  test("no duplicates under format switches mid-year, and the yearly restart", () => {
    const formats: DocFormat[] = [
      { prefix: "SO-", fy: "none", pad: 0 },
      { prefix: "SO-", fy: "none", pad: 4 },
      { prefix: "SO-", fy: "short", pad: 0 },
      { prefix: "SO/", fy: "long", pad: 2 },
      { prefix: "", fy: "none", pad: 0 },
      { prefix: "", fy: "short", pad: 3 },
      { prefix: "SO-", fy: "none", pad: 0 },
    ];
    let rng = 7;
    const next = () => (rng = (rng * 48271) % 2147483647);
    for (const period of ["2026-27", "2027-28"]) {
      const seen = new Set<string>();
      let format = formats[0]!;
      for (let seq = 1; seq <= 3000; seq += 1) {
        if (next() % 97 === 0) format = formats[next() % formats.length]!;
        const text = formatDocNumberWith(format, period, seq);
        expect(seen.has(text)).toBe(false);
        seen.add(text);
      }
      // Restart: the first number of each year is sequence 1.
      expect(formatDocNumberWith(formats[0]!, period, 1)).toBe("SO-1");
    }
    // With the year in the text, the same sequence in two years prints two different numbers.
    const withYear: DocFormat = { prefix: "PL/", fy: "long", pad: 0 };
    expect(formatDocNumberWith(withYear, "2026-27", 1)).not.toBe(formatDocNumberWith(withYear, "2027-28", 1));
  });
});

describe("approver rules (#78)", () => {
  const BUILT_IN = ["owner", "admin", "manager"];

  test("no rule: the built-in approvers, for every kind", () => {
    expect(approverRolesFor("dc_note", BUILT_IN, {}, {})).toEqual(BUILT_IN);
    expect(approverRolesFor("anything_new", BUILT_IN, undefined, null)).toEqual(BUILT_IN);
    expect(possibleApproverRoles("dc_note", BUILT_IN, null)).toEqual(BUILT_IN);
  });

  test("a rule's roles, the owner always kept", () => {
    const rules = readApprovalRules({ dc_note: { roles: ["accountant"] } }, ROLES);
    expect(approverRolesFor("dc_note", BUILT_IN, rules, {})).toEqual(["owner", "accountant"]);
  });

  test("dispatch overdraw above 2% needs the owner", () => {
    const rules = readApprovalRules({ dispatch_overdraw: { roles: ["manager", "admin"], above: { value: 200, roles: ["owner"] } } }, ROLES);
    const meta = (orderedG: number, totalG: number) => ({ lines: [{ orderedG, totalG }] });
    // 1.5% over: manager may.
    expect(approverRolesFor("dispatch_overdraw", BUILT_IN, rules, meta(100_000, 101_500))).toEqual(["owner", "manager", "admin"]);
    // Exactly 2%: not above.
    expect(approverRolesFor("dispatch_overdraw", BUILT_IN, rules, meta(100_000, 102_000))).toEqual(["owner", "manager", "admin"]);
    // 2.01% over: owner only.
    expect(approverRolesFor("dispatch_overdraw", BUILT_IN, rules, meta(100_000, 102_010))).toEqual(["owner"]);
    // The worst line counts.
    expect(APPROVAL_MEASURES.dispatch_overdraw!.measure({ lines: [{ orderedG: 1000, totalG: 1010 }, { orderedG: 1000, totalG: 1050 }] })).toBe(500);
    expect(possibleApproverRoles("dispatch_overdraw", BUILT_IN, rules)).toEqual(["owner", "manager", "admin"]);
  });

  test("off band threshold reads grams per 12 ft either side", () => {
    expect(APPROVAL_MEASURES.dispatch_off_band!.measure({ diffMilli: -120 })).toBe(120);
  });

  test("checks", () => {
    expect(checkApprovalRule("dc_note", { roles: [] }, ROLES)).toBe("roles_empty");
    expect(checkApprovalRule("dc_note", { roles: ["boss"] }, ROLES)).toBe("role_unknown");
    expect(checkApprovalRule("dc_note", { roles: ["manager"], above: { value: 10, roles: ["owner"] } }, ROLES)).toBe("threshold_not_offered");
    expect(checkApprovalRule("dispatch_overdraw", { roles: ["manager"], above: { value: -1, roles: ["owner"] } }, ROLES)).toBe("threshold_range");
    expect(checkApprovalRule("dispatch_overdraw", { roles: ["manager"], above: { value: 1, roles: [] } }, ROLES)).toBe("above_roles_empty");
    expect(checkApprovalRule("dispatch_overdraw", { roles: ["manager"], above: { value: 200, roles: ["owner"] } }, ROLES)).toBeNull();
    // A stored bad rule is ignored, so the kind keeps its built-in approvers.
    expect(readApprovalRules({ dc_note: { roles: ["boss"] } }, ROLES)).toEqual({});
  });
});

describe("masters helpers", () => {
  test("IFSC and account numbers", () => {
    expect(isIfsc("sbin0001234")).toBe(true);
    expect(isIfsc("SBIN1001234")).toBe(false);
    expect(isBankAccountNo("1234 5678 9012")).toBe(true);
    expect(isBankAccountNo("12AB")).toBe(false);
  });

  test("transit insurance prints only while valid and marked to print", () => {
    const ins = readTransitInsurance({ policyNo: " P-77 ", insurer: "New India", validFrom: "2026-04-01", validTo: "2027-03-31" })!;
    expect(ins).toEqual({ policyNo: "P-77", insurer: "New India", validFrom: "2026-04-01", validTo: "2027-03-31", printOnPl: true });
    expect(insuranceForPl(ins, "2026-11-22")).toEqual({ policyNo: "P-77", insurer: "New India", validTo: "2027-03-31" });
    expect(insuranceForPl(ins, "2027-04-01")).toBeNull();
    expect(insuranceForPl(ins, "2026-03-31")).toBeNull();
    expect(insuranceForPl({ ...ins, printOnPl: false }, "2026-11-22")).toBeNull();
    expect(readTransitInsurance({ policyNo: "", insurer: "X" })).toBeNull();
    expect(readTransitInsurance({ policyNo: "P", insurer: "X", validTo: "2026-02-30" })!.validTo).toBeNull();
  });

  test("tooling shortfalls", () => {
    const min = readToolingMinStock({ bolster: 2, backer: 0, liner: 3, nonsense: 5 });
    expect(min).toEqual({ bolster: 2, liner: 3 });
    expect(toolingShortfalls(min, { bolster: 2, liner: 1 })).toEqual([{ type: "liner", held: 1, min: 3 }]);
    expect(toolingShortfalls(min, {})).toEqual([
      { type: "bolster", held: 0, min: 2 },
      { type: "liner", held: 0, min: 3 },
    ]);
  });

  test("die cost per kg, half up, in paise", () => {
    // Rs 1,50,000 over 12,345.678 kg = Rs 12.150 /kg = 1215 paise.
    expect(dieCostPerKgPaise(15_000_000, 12_345_678)).toBe(1215);
    expect(dieCostPerKgPaise(100, 3_000)).toBe(33);
    expect(dieCostPerKgPaise(100, 2_000)).toBe(50);
    expect(dieCostPerKgPaise(null, 1000)).toBeNull();
    expect(dieCostPerKgPaise(100, 0)).toBeNull();
  });

  test("document review due", () => {
    expect(documentReviewDue("2026-11-22", "2026-11-22")).toBe(true);
    expect(documentReviewDue("2026-11-23", "2026-11-22")).toBe(false);
    expect(documentReviewDue(null, "2026-11-22")).toBe(false);
  });
});

describe("bank on printed papers (PROD-GATE, ADM contract 4)", () => {
  test("bank and branch, account name, account number, IFSC, in print order", () => {
    expect(bankPrintParts({ bankName: "HDFC Bank", branch: "Naroda", accountName: "Fourcubes Industries LLP", accountNo: "50200012345678", ifsc: "HDFC0001234" })).toEqual([
      "HDFC Bank, Naroda",
      "Fourcubes Industries LLP",
      "A/c 50200012345678",
      "IFSC HDFC0001234",
    ]);
  });
  test("no branch: the bank name alone heads the lines", () => {
    expect(bankPrintParts({ bankName: "SBI", branch: null, accountName: "Plant", accountNo: "1", ifsc: "SBIN0000001" })[0]).toBe("SBI");
  });
});
