import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { can, type Me } from "@orrn/server/lib/permissions";

import { canCancelCast } from "../features/foundry/foundry-model";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
const detail = read("features/foundry/cast-detail.tsx");
const castSheet = read("features/foundry/close-sheet.tsx");
const meltSheet = read("features/foundry/melt-sheet-view.tsx");

function me(role: NonNullable<Me["company"]>["role"]): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules: ["foundry"] },
    isPlatformAdmin: false,
  };
}

describe("cast and melt cancel rules", () => {
  test("only an open cast with no live or draft melt offers cancel", () => {
    expect(canCancelCast("open", { liveMelts: 0, draftMelts: 0 })).toBe(true);
    expect(canCancelCast("open", { liveMelts: 1, draftMelts: 0 })).toBe(false);
    expect(canCancelCast("open", { liveMelts: 0, draftMelts: 1 })).toBe(false);
    expect(canCancelCast("closed", { liveMelts: 0, draftMelts: 0 })).toBe(false);
    expect(canCancelCast("closing", { liveMelts: 0, draftMelts: 0 })).toBe(false);
  });

  test("both actions require cast.close, which foundry lacks and supervisors hold", () => {
    expect(can(me("foundry"), "cast.close")).toBe(false);
    expect(can(me("supervisor"), "cast.close")).toBe(true);
    expect(can(me("packer"), "cast.close")).toBe(false);
    expect(detail).toMatch(/<Can do="cast\.close">[\s\S]*<CancelCastSheet/);
    expect(meltSheet).toMatch(/<Can do="cast\.close">[\s\S]*foundry\.melt\.cancel\.button/);
  });

  test("cast cancel follows the empty-cast rule and melt cancel needs a locked melt of an open cast", () => {
    expect(detail).toContain("canCancelCast(c.status, co)");
    expect(meltSheet).toContain('status === "locked" && cast.status === "open"');
    expect(meltSheet).toContain("<CancelMelt melt={melt} castNumber={cast.number} />");
  });

  test("the confirms require a reason and send the web's procedure bodies", () => {
    expect(castSheet).toContain("trpc.foundry.casts.cancel.mutationOptions()");
    expect(castSheet).toContain("cancel.mutateAsync(castCancelBody(castId, reason))");
    expect(meltSheet).toContain("trpc.foundry.melts.cancel.mutationOptions()");
    expect(meltSheet).toContain("cancel.mutateAsync(meltCancelBody(melt.id, reason))");
    for (const source of [castSheet, meltSheet]) {
      expect(source).toContain("if (!reason.trim()) return;");
      expect(source).toContain("maxLength={500}");
      expect(source).toContain("reasonRequired");
    }
  });

  test("refusals use foundryError and unsure answers refresh foundry state", () => {
    for (const source of [castSheet, meltSheet]) {
      expect(source).toContain("announce(foundryError(t, error))");
      expect(source).toContain("<ErrorLine error={problem} />");
      expect(source).toMatch(/writeFailureKind\(error\) === "unsure"[\s\S]*invalidateQueries/);
    }
  });
});
