import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Me } from "@orrn/server/lib/permissions";

import { moreRows } from "../features/more/more-rows";

const NATIVE = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(NATIVE, path), "utf8");

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = ["foundry"]): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

describe("foundry masters under More", () => {
  test("foundry and masters roles see both read-only lists", () => {
    for (const role of ["foundry", "supervisor", "manager", "office"] as const) {
      expect({ role, rows: moreRows(me(role)).filter((r) => r.key === "furnaces" || r.key === "alloys").map((r) => r.key) }).toEqual({ role, rows: ["furnaces", "alloys"] });
    }
    expect(moreRows(me("foundry")).find((r) => r.key === "furnaces")?.href).toBe("/more/furnaces");
    expect(moreRows(me("foundry")).find((r) => r.key === "alloys")?.href).toBe("/more/alloys");
  });

  test("other roles and plants without foundry do not see the rows", () => {
    for (const role of ["packer", "viewer", "press", "die_room"] as const) {
      expect(moreRows(me(role)).some((r) => r.key === "furnaces" || r.key === "alloys")).toBe(false);
    }
    expect(moreRows(me("foundry", ["bundles"])).some((r) => r.key === "furnaces" || r.key === "alloys")).toBe(false);
  });

  test("both routes and their stack titles exist", () => {
    for (const route of ["furnaces", "alloys"]) {
      expect(existsSync(join(NATIVE, `app/more/${route}.tsx`))).toBe(true);
      expect(read("app/more/_layout.tsx")).toContain(`name="${route}"`);
    }
  });

  test("the screens send the web's list reads and show its columns", () => {
    const source = read("features/foundry/masters-view.tsx");
    expect(source).toContain("trpc.foundry.furnaces.list.queryOptions()");
    expect(source).toContain("trpc.foundry.alloys.list.queryOptions()");
    for (const field of ["f.code", "f.name", "f.capacityG", "f.billetDiaMm", "f.status", "a.code", "a.name", "a.limits", "a.status"]) expect(source).toContain(field);
    expect(source).not.toContain("mutationOptions");
  });

  test("a failed list read shows the shared refusal block with retry", () => {
    const source = read("features/foundry/masters-view.tsx");
    expect(source).toContain("<ErrorBlock error={error} onRetry={retry} retrying={retrying} />");
  });
});
