import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createI18n } from "@orrn/i18n";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";
import type { Me } from "@orrn/server/lib/permissions";

import { LEAVE_REFUSALS, leaveError } from "../features/me/errors";
import { monthName, slipView } from "../features/me/explain";
import { attendanceFigures, canCancel, isNotLinked, leaveInput, statusTone } from "../features/me/model";
import { moreRouteAccess } from "../features/more/access";
import { showsMyPayslips, showsMyWork } from "../features/more/more-rows";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function me(role: NonNullable<Me["company"]>["role"], modules: string[]): Me {
  return { user: { id: "u", name: "A", email: "a@b.in" }, company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules }, isPlatformAdmin: false };
}

type Tree = { readonly [k: string]: string | Tree };
function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}
const pick = (m: unknown, path: string[]): Tree => path.reduce((a, k) => (a as Tree)[k] as Tree, m as Tree);

describe("who sees My work and My payslips", () => {
  test("My work: hr on and leave.apply; payslips also need payroll", () => {
    expect(showsMyWork(me("packer", ["hr"]))).toBe(true);
    expect(showsMyWork(me("packer", ["payroll"]))).toBe(false);
    expect(showsMyWork(me("packer", []))).toBe(false);
    expect(showsMyPayslips(me("packer", ["hr"]))).toBe(false);
    expect(showsMyPayslips(me("packer", ["hr", "payroll"]))).toBe(true);
    expect(showsMyPayslips(me("packer", ["payroll"]))).toBe(false);
  });
  test("a deep link is refused the same way", () => {
    expect(moreRouteAccess(me("packer", ["hr"]), "me")).toBe("allowed");
    expect(moreRouteAccess(me("packer", ["hr"]), "payslips")).toBe("not_allowed");
    expect(moreRouteAccess(me("packer", ["hr", "payroll"]), "payslips")).toBe("allowed");
    expect(moreRouteAccess(me("packer", []), "me")).toBe("not_allowed");
    expect(moreRouteAccess(null, "me")).toBe("not_allowed");
  });
});

describe("routes", () => {
  test("every screen exists and is named in the More stack", () => {
    const layout = read("app/more/_layout.tsx");
    for (const [file, name] of [
      ["app/more/me/index.tsx", "me/index"],
      ["app/more/me/leave.tsx", "me/leave"],
      ["app/more/me/payslips.tsx", "me/payslips"],
      ["app/more/me/payslip/[id].tsx", "me/payslip/[id]"],
    ] as const) {
      expect({ file, there: existsSync(join(ROOT, file)) }).toEqual({ file, there: true });
      expect(layout).toContain(`name="${name}"`);
    }
  });
  test("every screen checks the person may open it", () => {
    for (const f of ["app/more/me/index.tsx", "app/more/me/leave.tsx", "app/more/me/payslips.tsx", "app/more/me/payslip/[id].tsx"]) expect(read(f)).toContain("moreRouteAccess(");
  });
});

describe("the leave form", () => {
  const base = { kindId: "k1", from: "2026-11-03", to: "2026-11-05", halfDay: false, reason: "" };
  test("a good form; a half day is one day; the reason is trimmed or null", () => {
    expect(leaveInput(base)).toEqual({ ok: true, input: { kindId: "k1", from: "2026-11-03", to: "2026-11-05", halfDay: false, reason: null } });
    expect(leaveInput({ ...base, to: "2026-11-03", halfDay: true, reason: " fever " })).toMatchObject({ ok: true, input: { halfDay: true, reason: "fever" } });
    expect(leaveInput({ ...base, halfDay: true })).toMatchObject({ ok: true, input: { halfDay: false } });
  });
  test("a kind, real dates and an order", () => {
    expect(leaveInput({ ...base, kindId: "" })).toEqual({ ok: false, error: "needKind" });
    expect(leaveInput({ ...base, from: "03-11-2026" })).toEqual({ ok: false, error: "needDays" });
    expect(leaveInput({ ...base, from: "2026-02-30", to: "2026-03-01" })).toEqual({ ok: false, error: "needDays" });
    expect(leaveInput({ ...base, to: "2026-11-02" })).toEqual({ ok: false, error: "needDays" });
  });
  test("only a waiting request is cancelled; tones", () => {
    expect(["pending", "approved", "rejected", "cancelled"].map(canCancel)).toEqual([true, false, false, false]);
    expect(["approved", "rejected", "pending", "cancelled"].map(statusTone)).toEqual(["green", "red", "amber", "neutral"]);
  });
  test("a login with no person behind it", () => {
    expect(isNotLinked({ data: { code: "NOT_FOUND" } })).toBe(true);
    expect(isNotLinked(new globalThis.Error("x"))).toBe(false);
  });
  test("the month card counts present in days", () => {
    const f = attendanceFigures({ days: 30, presentHalves: 45, absent: 1, halfDays: 1, leavePaid: 2, leaveUnpaid: 0, weeklyOff: 4, holiday: 1, notMarked: 3, overtimeMin: 0, lopHalves: 0, paidHalves: 0 });
    expect(f[0]).toEqual({ key: "present", value: "22.5" });
    expect(f.map((x) => x.key)).toEqual(["present", "absent", "halfDays", "leavePaid", "leaveUnpaid", "weeklyOff", "holiday", "notMarked"]);
  });
});

describe("what a refused leave write says", () => {
  const t = createI18n("en").t;
  /** A refusal the way tRPC delivers one: a message and a 4xx. */
  const Error = (message: string) => Object.assign(new globalThis.Error(message), { data: { httpStatus: 400 } });
  test("each server sentence is matched and said in words", () => {
    expect(leaveError(t, Error("A leave on these days is already asked or approved"))).toBe(en.native.hr.refusal.overlap);
    expect(leaveError(t, Error("Only a waiting leave can be cancelled here; ask your supervisor"))).toBe(en.native.hr.refusal.notWaiting);
    expect(leaveError(t, Error("Only a waiting or approved leave can be cancelled"))).toBe(en.native.hr.refusal.notWaiting);
    expect(leaveError(t, Error("Only 1.5 days of CL are left"))).toBe("Only 1.5 days of CL are left.");
    expect(leaveError(t, Error("Ramesh joined on 2026-04-01"))).toBe(en.native.hr.refusal.beforeJoin);
    expect(leaveError(t, Error("The payroll for 2026-10 is locked; corrections go in the next month"))).toBe(en.native.hr.refusal.locked);
  });
  test("an answer that never came says it is not sure the request was saved", () => {
    expect(leaveError(t, new globalThis.Error("network"))).toBe(en.native.hr.leave.unsure);
  });
  test("an unknown sentence is not shown as the server wrote it", () => {
    expect(leaveError(t, Error("Some new English sentence"))).not.toContain("Some new English sentence");
  });
  test("every sentence the server can say here is in the table (read from the server source)", () => {
    const server = readFileSync(join(ROOT, "..", "..", "packages", "server", "src", "lib", "hr", "leave.ts"), "utf8");
    const sentences = [...server.matchAll(/(?:bad|conflict)\(`?"?([^"`]+)["`]?\)/g)].map((m) => m[1]!.replace(/\$\{[^}]+\}/g, "X"));
    const apply = sentences.filter((s) => /^(The last day|Split a leave|A leave can|Those days|A leave on|Only X days)/.test(s) || /joined on|has left/.test(s));
    expect(apply.length).toBeGreaterThanOrEqual(6);
    for (const s of apply) {
      const sample = s.replace(/^X joined on X$/, "Ramesh joined on 2026-04-01").replace(/^X has left$/, "Ramesh has left").replace(/Only X days of X are left/, "Only 2 days of CL are left").replace(/X/g, "1");
      expect({ s, matched: LEAVE_REFUSALS.some((e) => e.re.test(sample)) }).toEqual({ s, matched: true });
    }
  });
});

describe("the words", () => {
  const phoneKeys = (m: unknown) => leaves(pick(m, ["native", "hr"]), "native.hr.");
  const payslipKeys = (m: unknown) => leaves(pick(m, ["payroll", "payslip"]), "payroll.payslip.");
  test("every native.hr and payroll.payslip key has en, hi and gu, with the same variables", () => {
    const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)/g)].map((m) => m[1]))].sort().join(",");
    for (const get of [phoneKeys, payslipKeys]) {
      const enMap = get(en);
      const hiMap = new Map(get(hi));
      const guMap = new Map(get(gu));
      for (const [k, v] of enMap) {
        expect({ k, hi: hiMap.has(k), gu: guMap.has(k) }).toEqual({ k, hi: true, gu: true });
        expect({ k, vars: vars(hiMap.get(k)!) }).toEqual({ k, vars: vars(v) });
        expect({ k, vars: vars(guMap.get(k)!) }).toEqual({ k, vars: vars(v) });
      }
    }
  });
  test("a payslip reads in the viewer's language on the phone", () => {
    const t = createI18n("gu").t;
    expect(/[઀-૿]/.test(monthName(t, "2026-11"))).toBe(true);
  });
  test("the phone's explain.ts is the web's, byte for byte", () => {
    expect(read("features/me/explain.ts")).toBe(readFileSync(join(ROOT, "..", "web", "src", "features", "payroll", "explain.ts"), "utf8"));
  });
  test("slipView needs nothing but the figures and t (guards the copy)", () => {
    expect(typeof slipView).toBe("function");
  });
});

describe("the writes", () => {
  const sources = ["features/me/leave-view.tsx"].map(read).join("\n");
  test("apply and cancel are sent through the guarded wrapper, once, with no retry and no key the server ignores", () => {
    expect(sources).toContain("trpc.hr.me.applyLeave.mutationOptions(");
    expect(sources).toContain("trpc.hr.me.cancelLeave.mutationOptions(");
    expect(sources).toContain("useGuardedWrite(");
    expect(sources).not.toMatch(/sendOnce|retry:|clientRequestId|clientMutationId/);
  });
  test("the buttons that write sit inside <Can do=leave.apply> and a cancel asks first", () => {
    expect(sources).toContain('<Can do="leave.apply">');
    expect(sources).toContain("Alert.alert(");
  });
  test("no screen reads error.message", () => {
    for (const f of ["features/me/leave-view.tsx", "features/me/home-view.tsx", "features/me/payslips-view.tsx", "features/me/payslip-view.tsx"]) expect(read(f)).not.toContain("error.message");
  });
  test("the self-service reads never send an employee id", () => {
    for (const f of ["features/me/leave-view.tsx", "features/me/home-view.tsx", "features/me/payslips-view.tsx", "features/me/payslip-view.tsx"]) expect(read(f)).not.toMatch(/employeeId/);
  });
});
