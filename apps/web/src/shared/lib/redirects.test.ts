import { describe, expect, test } from "bun:test";

import { STATIC_REDIRECTS, resolveRedirect } from "./redirects";

/** Spec §3.2, one row per old path. `/setup-credentials` is ruling R6, not the spec's `/welcome`. */
const SPEC_ROWS: readonly (readonly [old: string, next: string])[] = [
  ["/dashboard", "/today"],
  ["/receipts", "/pack"],
  ["/receipts/new", "/pack/new"],
  ["/bundles", "/stock/bundles"],
  ["/dispatches", "/dispatch"],
  ["/dispatches/new", "/dispatch/new"],
  ["/spool", "/printing"],
  ["/settings/members", "/settings?tab=team"],
  ["/setup-credentials", "/welcome?magic=1"],
  ["/onboarding", "/welcome"],
  ["/change-password", "/welcome"],
  ["/waitlist", "/request-access"],
  ["/admin/waitlist", "/admin/requests"],
  // Spec §3.2/§3: "redirects to /admin/companies with a Printing filter".
  ["/admin/spool", "/admin/companies?printing=1"],
];

describe("STATIC_REDIRECTS", () => {
  test("holds every spec row exactly", () => {
    for (const [old, next] of SPEC_ROWS) expect(STATIC_REDIRECTS[old]).toBe(next);
    expect(Object.keys(STATIC_REDIRECTS).sort()).toEqual(SPEC_ROWS.map(([old]) => old).sort());
  });
});

describe("resolveRedirect: static rows", () => {
  for (const [old, next] of SPEC_ROWS) {
    test(`${old} -> ${next}`, () => {
      expect(resolveRedirect(old, "")).toBe(next);
    });
  }

  test("old print station queries carry over next to the Printing filter, except its status", () => {
    // A print station status is not a company status: the old filter is dropped, not carried over.
    expect(resolveRedirect("/admin/spool", "?status=active")).toBe("/admin/companies?printing=1");
    expect(resolveRedirect("/admin/spool", "?status=revoked&q=ram")).toBe("/admin/companies?printing=1&q=ram");
    expect(resolveRedirect("/admin/spool/", "printing=0")).toBe("/admin/companies?printing=1");
  });

  test("a trailing slash is the same path", () => {
    expect(resolveRedirect("/receipts/", "")).toBe("/pack");
    expect(resolveRedirect("/dashboard/", "")).toBe("/today");
  });
});

describe("resolveRedirect: parameters", () => {
  test("/receipts/$id -> /pack/$id", () => {
    expect(resolveRedirect("/receipts/abc", "")).toBe("/pack/abc");
  });

  test("/dispatches/$id -> /dispatch/$id", () => {
    expect(resolveRedirect("/dispatches/x", "")).toBe("/dispatch/x");
  });

  test("ids keep their encoding", () => {
    expect(resolveRedirect("/receipts/a%20b", "")).toBe("/pack/a%20b");
    expect(resolveRedirect("/dispatches/a%2Fb", "")).toBe("/dispatch/a%2Fb");
  });

  test("/dispatches/new is the static row, not an id", () => {
    expect(resolveRedirect("/dispatches/new", "")).toBe("/dispatch/new");
    expect(resolveRedirect("/receipts/new", "")).toBe("/pack/new");
  });

  test("ids that need a server lookup are left to the route loader", () => {
    expect(resolveRedirect("/bundles/abc", "")).toBeNull();
    expect(resolveRedirect("/packing-lists/abc", "")).toBeNull();
  });
});

describe("resolveRedirect: query preservation", () => {
  test("/bundles?status=void -> /stock/bundles?status=void", () => {
    expect(resolveRedirect("/bundles", "?status=void")).toBe("/stock/bundles?status=void");
  });

  test("search without a leading ? works", () => {
    expect(resolveRedirect("/bundles", "status=void&dieId=d1")).toBe("/stock/bundles?status=void&dieId=d1");
  });

  test("an empty search adds nothing", () => {
    expect(resolveRedirect("/bundles", "?")).toBe("/stock/bundles");
  });

  test("params and query together", () => {
    expect(resolveRedirect("/dispatches/x", "?tab=scan")).toBe("/dispatch/x?tab=scan");
  });

  test("merges into a target that already has a query", () => {
    expect(resolveRedirect("/settings/members", "?invite=1")).toBe("/settings?tab=team&invite=1");
    expect(resolveRedirect("/setup-credentials", "?token=t1")).toBe("/welcome?magic=1&token=t1");
  });

  test("the target's own params win over an incoming one of the same name", () => {
    expect(resolveRedirect("/settings/members", "?tab=data")).toBe("/settings?tab=team");
  });

  test("the waitlist mode survives", () => {
    expect(resolveRedirect("/waitlist", "?mode=demo")).toBe("/request-access?mode=demo");
  });
});

describe("resolveRedirect: paths that are not old URLs", () => {
  test("new, shared and unknown paths return null", () => {
    for (const path of ["/today", "/pack", "/pack/abc", "/stock", "/stock/bundles", "/b/26I4086", "/dispatch", "/dies", "/customers/c1", "/login", "/admin", "/admin/companies", "/", "/receiptsx", "/dashboards"]) {
      expect(resolveRedirect(path, "")).toBeNull();
    }
  });

  test("a deeper path under a static row is not swallowed", () => {
    expect(resolveRedirect("/dashboard/extra", "")).toBeNull();
    expect(resolveRedirect("/receipts/a/b", "")).toBeNull();
  });
});
