import { describe, expect, test } from "bun:test";

import { buildTimeline, type StatusEvent } from "./timeline";

const ev = (over: Partial<StatusEvent> & Pick<StatusEvent, "id" | "toStatus" | "at">): StatusEvent => ({
  fromStatus: null,
  reason: null,
  dispatchId: null,
  ...over,
});

const PACKED_AT = "2026-10-01T05:00:00.000Z";

describe("buildTimeline", () => {
  test("newest first, each event named in floor words", () => {
    const entries = buildTimeline(
      [
        ev({ id: "4", fromStatus: "reserved", toStatus: "dispatched", reason: "dispatch.complete", dispatchId: "d1", at: "2026-10-03T09:00:00.000Z" }),
        ev({ id: "3", fromStatus: "available", toStatus: "reserved", reason: "dispatch.reserve", dispatchId: "d1", at: "2026-10-02T09:00:00.000Z" }),
        ev({ id: "1", toStatus: "available", reason: "receipt", at: PACKED_AT }),
      ],
      { createdAt: PACKED_AT },
    );
    expect(entries.map((e) => e.kind)).toEqual(["dispatched", "held", "packed"]);
    expect(entries[0]).toMatchObject({ status: "dispatched", dispatchId: "d1", note: null });
    expect(entries[2]!.at.toISOString()).toBe(PACKED_AT);
  });

  test("void and restore show the reason the person typed", () => {
    const entries = buildTimeline(
      [
        ev({ id: "3", fromStatus: "void", toStatus: "available", reason: "Found on rack B", at: "2026-10-03T10:00:00.000Z" }),
        ev({ id: "2", fromStatus: "available", toStatus: "void", reason: "Packed twice", at: "2026-10-02T10:00:00.000Z" }),
        ev({ id: "1", toStatus: "available", reason: "receipt", at: PACKED_AT }),
      ],
      { createdAt: PACKED_AT },
    );
    expect(entries.map((e) => [e.kind, e.note])).toEqual([
      ["restored", "Found on rack B"],
      ["voided", "Packed twice"],
      ["packed", null],
    ]);
  });

  test("a hold released by the dispatch reads as released; system reasons never show as notes", () => {
    const [released, cancelled] = buildTimeline(
      [
        ev({ id: "2", fromStatus: "reserved", toStatus: "available", reason: "dispatch.unreserve", at: "2026-10-03T10:00:00.000Z" }),
        ev({ id: "1", fromStatus: "reserved", toStatus: "available", reason: "Customer changed the order", at: "2026-10-02T10:00:00.000Z" }),
      ],
      { createdAt: PACKED_AT },
    );
    expect(released).toMatchObject({ kind: "released", note: null });
    // A cancel with a typed reason keeps it.
    expect(cancelled).toMatchObject({ kind: "released", note: "Customer changed the order" });
  });

  test("bundles without a pack event (imports, old data) still start with Packed at their creation time", () => {
    const entries = buildTimeline(
      [ev({ id: "1", fromStatus: "available", toStatus: "void", reason: "Bent", at: "2026-10-02T10:00:00.000Z" })],
      { createdAt: PACKED_AT },
    );
    expect(entries.map((e) => e.kind)).toEqual(["voided", "packed"]);
    expect(entries[1]!.at.toISOString()).toBe(PACKED_AT);
  });

  test("a legacy import reads as imported", () => {
    const [e] = buildTimeline([ev({ id: "1", toStatus: "available", reason: "legacy-import", at: PACKED_AT })], {
      createdAt: PACKED_AT,
    });
    expect(e).toMatchObject({ kind: "imported", note: null });
  });

  test("events at the same time keep the server order (newest first)", () => {
    const same = "2026-10-02T10:00:00.000Z";
    const entries = buildTimeline(
      [
        ev({ id: "b", fromStatus: "reserved", toStatus: "dispatched", reason: "dispatch.complete", at: same }),
        ev({ id: "a", fromStatus: "available", toStatus: "reserved", reason: "dispatch.reserve", at: same }),
      ],
      { createdAt: PACKED_AT },
    );
    expect(entries.map((e) => e.id)).toEqual(["b", "a", "packed"]);
  });
});

describe("history actor", () => {
  test("each entry carries who did it, null when the server has no name", () => {
    const events: StatusEvent[] = [
      { id: "e2", fromStatus: "available", toStatus: "reserved", reason: "dispatch.addBundle", dispatchId: "d1", at: "2026-10-03T10:00:00.000Z", actorName: "Ramesh" },
      { id: "e1", fromStatus: null, toStatus: "available", reason: "receipt", dispatchId: null, at: "2026-10-03T09:00:00.000Z" },
    ];
    const entries = buildTimeline(events, { createdAt: "2026-10-03T09:00:00.000Z" });
    expect(entries.map((e) => [e.kind, e.actorName])).toEqual([
      ["held", "Ramesh"],
      ["packed", null],
    ]);
  });
});
