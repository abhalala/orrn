import { describe, expect, test } from "bun:test";

import { BUNDLE_STATUSES, DISPATCH_STATUSES, bundleTone, dispatchActions, dispatchTone } from "./status";

describe("tones", () => {
  test("bundle", () => {
    expect(bundleTone("available")).toBe("green");
    expect(bundleTone("reserved")).toBe("blue");
    expect(bundleTone("dispatched")).toBe("neutral");
    expect(bundleTone("void")).toBe("red");
  });
  test("dispatch", () => {
    expect(dispatchTone("draft")).toBe("amber");
    expect(dispatchTone("reserved")).toBe("blue");
    expect(dispatchTone("completed")).toBe("green");
    expect(dispatchTone("cancelled")).toBe("red");
  });
  test("status lists", () => {
    expect([...BUNDLE_STATUSES]).toEqual(["available", "reserved", "dispatched", "void"]);
    expect([...DISPATCH_STATUSES]).toEqual(["draft", "reserved", "completed", "cancelled"]);
  });
});

describe("dispatchActions", () => {
  test("draft", () => {
    expect(dispatchActions("draft")).toEqual({
      canEdit: true,
      canReserve: true,
      canUnreserve: false,
      canComplete: false,
      canCancel: true,
      canDelete: true,
    });
  });
  test("reserved", () => {
    expect(dispatchActions("reserved")).toEqual({
      canEdit: false,
      canReserve: false,
      canUnreserve: true,
      canComplete: true,
      canCancel: true,
      canDelete: false,
    });
  });
  test("completed is terminal and undeletable", () => {
    expect(dispatchActions("completed")).toEqual({
      canEdit: false,
      canReserve: false,
      canUnreserve: false,
      canComplete: false,
      canCancel: false,
      canDelete: false,
    });
  });
  test("cancelled is terminal but deletable", () => {
    expect(dispatchActions("cancelled")).toEqual({
      canEdit: false,
      canReserve: false,
      canUnreserve: false,
      canComplete: false,
      canCancel: false,
      canDelete: true,
    });
  });
});
