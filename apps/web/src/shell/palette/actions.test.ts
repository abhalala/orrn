import { describe, expect, test } from "bun:test";

import { buildCommands, toThemeChoice, visibleSections, type CommandEnv } from "./actions";
import type { PageSection } from "./page-index";
import { testMe } from "./test-me";

function ids(env: Partial<CommandEnv> & Pick<CommandEnv, "me">): string[] {
  return buildCommands({ locale: "en", theme: "system", scanAvailable: true, arrangeAvailable: true, hasRecents: false, ...env }).map((c) => c.id);
}

describe("palette commands: gating", () => {
  test("owner sees every create command", () => {
    const list = ids({ me: testMe("owner") });
    for (const id of ["new-dispatch", "new-order", "new-pack", "upload-import", "scan-bundle", "print-queue", "arrange-menu", "sign-out"]) {
      expect(list).toContain(id);
    }
  });

  test("a viewer gets no create commands", () => {
    const list = ids({ me: testMe("viewer") });
    for (const id of ["new-dispatch", "new-order", "new-pack", "upload-import", "new-cast", "load-ageing"]) {
      expect(list).not.toContain(id);
    }
    // The viewer can read the print queue (spool.view_queue), like the Printing nav item.
    expect(list).toContain("print-queue");
  });

  test("the screen's own action decides: foundry enters casts, a packer packs", () => {
    expect(ids({ me: testMe("foundry") })).toContain("new-cast");
    expect(ids({ me: testMe("packer") })).toContain("new-pack");
    expect(ids({ me: testMe("packer") })).not.toContain("new-cast");
    expect(ids({ me: testMe("press") })).toContain("load-ageing");
    expect(ids({ me: testMe("office") })).not.toContain("load-ageing");
  });

  test("company modules hide commands for modules that are off", () => {
    const list = ids({ me: testMe("owner", { modules: ["customers"] }) });
    expect(list).not.toContain("new-dispatch");
    expect(list).not.toContain("new-pack");
    expect(list).not.toContain("scan-bundle");
  });

  test("scan needs the scan sheet; arrange needs the shell's opener and no impersonation", () => {
    expect(ids({ me: testMe("owner"), scanAvailable: false })).not.toContain("scan-bundle");
    expect(ids({ me: testMe("owner"), arrangeAvailable: false })).not.toContain("arrange-menu");
    expect(ids({ me: testMe("owner", { impersonating: true }) })).not.toContain("arrange-menu");
  });

  test("switch plant: one command per other plant, never with one plant or while impersonating", () => {
    expect(ids({ me: testMe("owner") }).filter((id) => id.startsWith("switch-plant"))).toEqual([]);
    expect(ids({ me: testMe("owner", { plants: 3 }) }).filter((id) => id.startsWith("switch-plant"))).toEqual([
      "switch-plant-plant-2",
      "switch-plant-plant-3",
    ]);
    expect(ids({ me: testMe("owner", { plants: 3, impersonating: true }) }).filter((id) => id.startsWith("switch-plant"))).toEqual([]);
  });

  test("language and theme leave out the current choice; clear recent only with recents", () => {
    const list = ids({ me: testMe("viewer"), locale: "hi", theme: "dark" });
    expect(list.filter((id) => id.startsWith("language-"))).toEqual(["language-en", "language-gu"]);
    expect(list.filter((id) => id.startsWith("theme-"))).toEqual(["theme-light", "theme-system"]);
    expect(list).not.toContain("clear-recent");
    expect(ids({ me: testMe("viewer"), hasRecents: true })).toContain("clear-recent");
    expect(toThemeChoice(undefined)).toBe("system");
  });

  test("signed out or no company: nothing", () => {
    expect(ids({ me: null })).toEqual([]);
  });
});

describe("page sections: gating", () => {
  const sections: PageSection[] = [
    { id: "dispatch.list", parentKey: "dispatch", label: "List", to: "/dispatch", terms: [] },
    { id: "dispatch.new", parentKey: "dispatch", label: "New", to: "/dispatch/new", terms: [], requires: ["dispatch.create"] },
    { id: "masters.alloys", parentKey: "masters", label: "Alloys", to: "/masters/alloys", terms: [] },
    { id: "reports.press", parentKey: "reports", label: "Press", to: "/reports", terms: [], module: "press" },
  ];

  test("a person who sees the parent but lacks the section's requires does not see the section", () => {
    // A viewer sees the Dispatch page but cannot create one.
    const viewer = visibleSections(testMe("viewer"), sections).map((s) => s.id);
    expect(viewer).toContain("dispatch.list");
    expect(viewer).not.toContain("dispatch.new");
    expect(visibleSections(testMe("owner"), sections).map((s) => s.id)).toContain("dispatch.new");
  });

  test("sections inherit the parent's gating", () => {
    expect(visibleSections(testMe("viewer"), sections).map((s) => s.id)).not.toContain("masters.alloys");
    expect(visibleSections(testMe("owner", { modules: ["bundles"] }), sections).map((s) => s.id)).not.toContain("dispatch.list");
  });

  test("a section's module gate applies on top of the parent's", () => {
    expect(visibleSections(testMe("owner"), sections).map((s) => s.id)).toContain("reports.press");
    expect(visibleSections(testMe("owner", { modules: ["bundles", "dispatches"] }), sections).map((s) => s.id)).not.toContain("reports.press");
  });

  test("the real section index never shows a section whose parent is hidden", () => {
    for (const s of visibleSections(testMe("viewer"))) expect(s.parentKey).not.toBe("masters");
  });
});
