import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { can, type Me } from "@orrn/server/lib/permissions";

const source = readFileSync(join(import.meta.dir, "../features/foundry/spectro-panel.tsx"), "utf8");

function me(role: NonNullable<Me["company"]>["role"]): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules: ["foundry"] },
    isPlatformAdmin: false,
  };
}

describe("spectro void on a phone draft", () => {
  test("the action uses melt.enter, shown to foundry and hidden from floor roles without it", () => {
    expect(can(me("foundry"), "melt.enter")).toBe(true);
    expect(can(me("supervisor"), "melt.enter")).toBe(true);
    expect(can(me("packer"), "melt.enter")).toBe(false);
    expect(can(me("viewer"), "melt.enter")).toBe(false);
    expect(source).toMatch(/<Can do="melt\.enter">[\s\S]*foundry\.spectro\.voidButton/);
  });

  test("only a live result of a draft in edit mode can be voided", () => {
    expect(source).toContain("canVoid={draft && !readOnly}");
    expect(source).toContain("canVoid && !voided");
  });

  test("the confirm uses the web keys, requires a reason and sends the same procedure body", () => {
    for (const key of ["foundry.spectro.voidTitle", "foundry.spectro.voidReason", "foundry.spectro.reasonRequired", "foundry.spectro.voidConfirm"]) expect(source).toContain(key);
    expect(source).toContain("maxLength={500}");
    expect(source).toContain("if (!reason.trim()) return;");
    expect(source).toContain("trpc.foundry.spectro.void.mutationOptions()");
    expect(source).toContain("voidResult.mutateAsync({ id, reason: reason.trim() })");
  });

  test("a refusal is translated and an unsure answer refreshes the result list", () => {
    expect(source).toContain("<ErrorLine error={problem} />");
    expect(source).toContain("announce(foundryError(t, error))");
    expect(source).toMatch(/writeFailureKind\(error\) === "unsure"\) refresh\(\)/);
    expect(source).toContain("result.voidReason");
  });
});
