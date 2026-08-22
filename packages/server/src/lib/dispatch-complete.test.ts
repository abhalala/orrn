import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { can } from "./permissions";
import { completeEventFromStatus } from "./dispatch-complete";

function setup() {
  const db = new Database(":memory:");
  db.run("CREATE TABLE bundle (id TEXT PRIMARY KEY, status TEXT, current_dispatch_id TEXT)");
  db.run("CREATE TABLE dispatch (id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  db.run("CREATE TABLE dispatch_item (dispatch_id TEXT, bundle_id TEXT)");
  db.run("CREATE TABLE packing_list (dispatch_id TEXT)");
  db.run("CREATE TABLE bundle_status_event (dispatch_id TEXT, bundle_id TEXT, from_status TEXT, to_status TEXT)");
  return db;
}

function complete(db: Database, dispatchId: string, from: "draft" | "reserved") {
  const ids = db.query("SELECT bundle_id AS id FROM dispatch_item WHERE dispatch_id = ?").all(dispatchId) as Array<{ id: string }>;
  const placeholders = ids.map(() => "?").join(",");
  db.run("BEGIN");
  try {
    if (from === "draft") {
      db.run(`UPDATE bundle SET status = 'dispatched', current_dispatch_id = ? WHERE id IN (${placeholders}) AND status = 'available'`, [dispatchId, ...ids.map(({ id }) => id)]);
    } else {
      db.run(`UPDATE bundle SET status = 'dispatched' WHERE id IN (${placeholders}) AND status = 'reserved' AND current_dispatch_id = ?`, [...ids.map(({ id }) => id), dispatchId]);
    }
    db.run("UPDATE dispatch SET status = CASE WHEN (SELECT COUNT(*) FROM bundle WHERE current_dispatch_id = ? AND status = 'dispatched') = ? THEN 'completed' ELSE NULL END WHERE id = ?", [dispatchId, ids.length, dispatchId]);
    for (const { id } of ids) {
      db.run("INSERT INTO bundle_status_event VALUES (?, ?, ?, 'dispatched')", [dispatchId, id, completeEventFromStatus(from)]);
    }
    db.run("INSERT INTO packing_list VALUES (?)", [dispatchId]);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

describe("dispatch complete lock", () => {
  test("draft completes directly from available and writes the packing list", () => {
    const db = setup();
    db.run("INSERT INTO dispatch VALUES ('d1', 'draft')");
    db.run("INSERT INTO bundle VALUES ('b1', 'available', NULL), ('b2', 'available', NULL)");
    db.run("INSERT INTO dispatch_item VALUES ('d1', 'b1'), ('d1', 'b2')");
    complete(db, "d1", "draft");
    expect(db.query("SELECT status, current_dispatch_id FROM bundle ORDER BY id").all()).toEqual([
      { status: "dispatched", current_dispatch_id: "d1" },
      { status: "dispatched", current_dispatch_id: "d1" },
    ]);
    expect(db.query("SELECT DISTINCT from_status, to_status FROM bundle_status_event").all()).toEqual([{ from_status: "available", to_status: "dispatched" }]);
    expect(db.query("SELECT COUNT(*) AS count FROM packing_list").get()).toEqual({ count: 1 });
  });

  test("stolen draft lot aborts every losing write", () => {
    const db = setup();
    db.run("INSERT INTO dispatch VALUES ('winner', 'completed'), ('loser', 'draft')");
    db.run("INSERT INTO bundle VALUES ('b1', 'dispatched', 'winner')");
    db.run("INSERT INTO dispatch_item VALUES ('loser', 'b1')");
    expect(() => complete(db, "loser", "draft")).toThrow("NOT NULL constraint failed");
    expect(db.query("SELECT status FROM dispatch WHERE id = 'loser'").get()).toEqual({ status: "draft" });
    expect(db.query("SELECT COUNT(*) AS count FROM packing_list WHERE dispatch_id = 'loser'").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM bundle_status_event WHERE dispatch_id = 'loser'").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM dispatch_item WHERE dispatch_id = 'loser'").get()).toEqual({ count: 1 });
  });

  test("reserved completion requires ownership and emits reserved to dispatched", () => {
    const db = setup();
    db.run("INSERT INTO dispatch VALUES ('d1', 'reserved')");
    db.run("INSERT INTO bundle VALUES ('b1', 'reserved', 'd1')");
    db.run("INSERT INTO dispatch_item VALUES ('d1', 'b1')");
    complete(db, "d1", "reserved");
    expect(db.query("SELECT from_status, to_status FROM bundle_status_event").get()).toEqual({ from_status: "reserved", to_status: "dispatched" });
  });

  test("reserved completion with the wrong owner rolls back", () => {
    const db = setup();
    db.run("INSERT INTO dispatch VALUES ('d1', 'reserved')");
    db.run("INSERT INTO bundle VALUES ('b1', 'reserved', 'other')");
    db.run("INSERT INTO dispatch_item VALUES ('d1', 'b1')");
    expect(() => complete(db, "d1", "reserved")).toThrow("dispatch.status");
    expect(db.query("SELECT status FROM dispatch WHERE id = 'd1'").get()).toEqual({ status: "reserved" });
    expect(db.query("SELECT status, current_dispatch_id FROM bundle").get()).toEqual({ status: "reserved", current_dispatch_id: "other" });
    expect(db.query("SELECT COUNT(*) AS count FROM packing_list").get()).toEqual({ count: 0 });
  });
});

test("dispatch permissions keep complete manager-only", () => {
  const expected = {
    viewer: [false, false, false, false, false, false],
    operator: [false, false, true, false, false, false],
    manager: [true, true, true, true, true, true],
  } as const;
  const actions = ["dispatch.complete", "dispatch.create", "dispatch.addBundle", "dispatch.reserve", "dispatch.update", "dispatch.delete"] as const;
  for (const [role, values] of Object.entries(expected)) {
    expect(actions.map((action) => can({ company: { role: role as "viewer" | "operator" | "manager" }, isPlatformAdmin: false }, action))).toEqual([...values]);
  }
});
