import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Me } from "@orrn/server/lib/permissions";

import { moreRows } from "../features/more/more-rows";

const NATIVE = join(import.meta.dir, "..");
const source = readFileSync(join(NATIVE, "features/dies/work-lists.tsx"), "utf8");

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = ["dies"]): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

describe("die room work lists", () => {
  test("the die room sees both rows under More, other floor roles do not", () => {
    expect(moreRows(me("die_room")).filter((r) => r.key === "nitriding" || r.key === "makers").map((r) => r.key)).toEqual(["nitriding", "makers"]);
    for (const role of ["packer", "press", "foundry", "viewer"] as const) {
      expect(moreRows(me(role)).some((r) => r.key === "nitriding" || r.key === "makers")).toBe(false);
    }
    expect(moreRows(me("die_room", ["bundles"])).some((r) => r.key === "nitriding" || r.key === "makers")).toBe(false);
  });

  test("both routes and titles are registered", () => {
    const layout = readFileSync(join(NATIVE, "app/more/_layout.tsx"), "utf8");
    for (const route of ["nitriding", "makers"]) {
      expect(existsSync(join(NATIVE, `app/more/${route}.tsx`))).toBe(true);
      expect(layout).toContain(`name="${route}"`);
    }
  });

  test("nitriding sends the status read and mirrors the web's copy columns", () => {
    expect(source).toContain('trpc.dieInstance.list.queryOptions({ status: "at_nitriding", limit: PAGE, offset })');
    for (const field of ["copy.code", "copy.sectionCode", "copy.sectionSeries", "copy.tierRank", "copy.latestKgPer12ftMilli", "copy.supplier"]) expect(source).toContain(field);
    expect(source).toContain("dieRoom.status.at_nitriding");
  });

  test("maker jobs asks only for sent jobs and mirrors job, copy, maker, purpose and sent date", () => {
    expect(source).toContain('trpc.dieInstance.maker.jobs.list.queryOptions({ status: "sent", limit: PAGE');
    for (const field of ["job.number", "job.code", "job.makerName", "job.purpose", "job.sentAt"]) expect(source).toContain(field);
    expect(source).toContain("query.data.nextCursor");
  });

  test("failed reads show retry and the lists have no writes", () => {
    expect(source).toContain("<ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />");
    expect(source).toContain("dieRoom.makers.noJobs");
    expect(source).not.toContain("mutationOptions");
  });
});
