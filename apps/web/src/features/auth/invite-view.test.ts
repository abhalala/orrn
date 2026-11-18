import { describe, expect, test } from "bun:test";

import { inviteView, type InviteStatusRead } from "./invite-view";

const live = (account: "none" | "password" | "noPassword", google = false): InviteStatusRead => ({
  state: "ready",
  status: { live: true, kind: "member", account, google },
});

describe("inviteView (plan 2026-11-18, Task 8)", () => {
  test("waits for both reads, and a failed read offers a retry", () => {
    expect(inviteView({ session: "pending", status: live("none") })).toBe("loading");
    expect(inviteView({ session: "signedOut", status: { state: "pending" } })).toBe("loading");
    expect(inviteView({ session: "failed", status: live("none") })).toBe("failed");
    expect(inviteView({ session: "signedOut", status: { state: "failed" } })).toBe("failed");
  });

  test("a dead link is dead, signed in or not", () => {
    for (const session of ["signedIn", "signedOut"] as const) {
      expect(inviteView({ session, status: { state: "ready", status: { live: false } } })).toBe("dead");
    }
  });

  test("signed in: join with this account, whatever the account state says", () => {
    for (const account of ["none", "password", "noPassword"] as const) {
      expect(inviteView({ session: "signedIn", status: live(account) })).toBe("join");
    }
  });

  test("signed out: create, sign in, or the no-password view, from the invited email's account", () => {
    expect(inviteView({ session: "signedOut", status: live("none") })).toBe("create");
    expect(inviteView({ session: "signedOut", status: live("password") })).toBe("signIn");
    expect(inviteView({ session: "signedOut", status: live("noPassword", true) })).toBe("noPassword");
  });

  test("what the page learned since wins: a dead accept, another account, or an account that turned up on sign-up", () => {
    expect(inviteView({ session: "signedIn", status: live("none"), learned: "expired" })).toBe("dead");
    expect(inviteView({ session: "signedIn", status: live("none"), learned: "wrongEmail" })).toBe("wrongEmail");
    expect(inviteView({ session: "signedOut", status: live("none"), learned: "signIn" })).toBe("signIn");
    // A learned sign-in step means nothing once someone is signed in: they join.
    expect(inviteView({ session: "signedIn", status: live("none"), learned: "signIn" })).toBe("join");
  });
});
