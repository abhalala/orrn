import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const agents = readFileSync(join(import.meta.dir, "../../../AGENTS.md"), "utf8");

describe("native foundry rules", () => {
  test("the rules describe the phone features now built", () => {
    expect(agents).toContain("Chemicals and LDO dips are editable on the phone");
    expect(agents).toContain("read-only furnace and alloy lists");
    expect(agents).toContain("nitriding and maker job lists");
    for (const write of ["spectro.void", "casts.cancel", "melts.cancel"]) expect(agents).toContain(write);
    expect(agents).not.toContain("Chemicals and LDO dips are not editable on the phone");
    expect(agents).not.toContain("furnace and alloy lists under More, and the lot picker's search are not built");
  });
});
