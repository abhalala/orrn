import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  acceptAfterSignInWith,
  createFocusRecheck,
  inviteScreen,
  inviteStatusQueryOptions,
  offersSetPasswordLink,
  setPasswordLinkError,
  type InviteOutcome,
} from "../features/invite/invite-flow";

/**
 * Council round 1, Lane B (plan 2026-11-18 fix wave): the invite screen's ways out of a wrong account
 * (B2), its status reads on focus (B3), and the set-password link after a failed password (B4). Bun
 * cannot render React Native here, so the decisions are pure and the wiring is read from the source.
 */

const ROOT = join(import.meta.dir, "..");
const screen = readFileSync(join(ROOT, "app/invite/[token].tsx"), "utf8");
const live = (account: "none" | "password" | "noPassword") => ({ live: true as const, kind: "member" as const, account, google: false });

function deps(acceptResult: "ok" | { data: { code: string } } | Error) {
  const log: string[] = [];
  let carried: InviteOutcome | null = null;
  const run = () =>
    acceptAfterSignInWith({
      accept: async () => {
        log.push("accept");
        if (acceptResult !== "ok") throw acceptResult;
      },
      signedIn: async () => {
        log.push("signedIn");
      },
      finish: async () => {
        log.push("finish");
      },
      onExpired: () => {
        log.push("expired");
      },
      carry: (outcome) => {
        carried = outcome;
        log.push(`carry:${outcome}`);
      },
    });
  return { run, log, carried: () => carried };
}

describe("B2: a sign-in on the invite screen is always known to the phone", () => {
  test("joined: accept, then the usual finish (which loads auth.me and tells the gate)", async () => {
    const d = deps("ok");
    expect(await d.run()).toBe("joined");
    expect(d.log).toEqual(["accept", "finish"]);
  });

  test("another account's sign-in: the wrong-account view is carried first, then the session is made known", async () => {
    const d = deps({ data: { code: "FORBIDDEN" } });
    expect(await d.run()).toBe("wrongEmail");
    // Carried before presence flips, so the signed-in view opens on the wrong-account notice and its sign-out.
    expect(d.log).toEqual(["accept", "carry:wrongEmail", "signedIn"]);
  });

  test("a failed accept after a sign-in still makes the session known, with the failure carried", async () => {
    const d = deps(new Error("Network request failed"));
    expect(await d.run()).toBe("failed");
    expect(d.log).toEqual(["accept", "carry:failed", "signedIn"]);
  });

  test("a link that died meanwhile: the expired notice, and the session is still made known", async () => {
    const d = deps({ data: { code: "NOT_FOUND" } });
    expect(await d.run()).toBe("expired");
    expect(d.log).toEqual(["accept", "expired", "signedIn"]);
    expect(d.carried()).toBeNull();
  });

  test("a carried failure opens the signed-in view even while the status is read again or that read fails", () => {
    expect(inviteScreen(true, "pending", true)).toBe("join");
    expect(inviteScreen(true, "failed", true)).toBe("join");
    expect(inviteScreen(true, live("password"), true)).toBe("join");
    // Signed out again: the carried failure no longer counts.
    expect(inviteScreen(false, live("password"), true)).toBe("signIn");
    expect(inviteScreen(false, "pending", true)).toBe("checking");
    // Without one, nothing changes.
    expect(inviteScreen(true, "pending")).toBe("checking");
  });

  test("the screen wires the sequence to the usual afterSignIn and passes the carried failure down", () => {
    expect(screen).toContain("acceptAfterSignInWith(");
    expect(screen).toMatch(/signedIn:\s*afterSignIn/);
    expect(screen).toMatch(/<SignedInInvite[^>]*carried=\{/);
    // The sign-out offer follows the outcome, not the words (a language switch must not hide it).
    expect(screen).not.toContain('failure?.text === t("native.invite.wrongEmail")');
    expect(screen).toMatch(/wrongEmail \?\s*\(\s*<Button[\s\S]{0,200}native\.invite\.signOutOther/);
  });
});

describe("B3: the status is read on focus only after the set-password link went", () => {
  test("the status query is never refetched by focus, reconnect or staleness on its own", () => {
    const options = inviteStatusQueryOptions();
    expect(options.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
    expect(options.retry).toBe(false);
    expect(screen).toContain("...inviteStatusQueryOptions()");
  });

  test("once per focus: a repeated focus without leaving the app reads nothing more", () => {
    let reads = 0;
    const onFocus = createFocusRecheck({ refetch: () => reads++, blocked: () => false });
    onFocus(true);
    onFocus(true);
    expect(reads).toBe(1);
    onFocus(false);
    onFocus(true);
    expect(reads).toBe(2);
  });

  test("never while a sign-in is open (a passkey or Google sheet also takes the app out of focus)", () => {
    let reads = 0;
    let busy = true;
    const onFocus = createFocusRecheck({ refetch: () => reads++, blocked: () => busy });
    onFocus(false);
    onFocus(true);
    expect(reads).toBe(0);
    busy = false;
    onFocus(false);
    onFocus(true);
    expect(reads).toBe(1);
  });

  test("the focus listener lives only in the sent state of the no-password view", () => {
    const subscribes = screen.match(/focusManager\.subscribe\(/g) ?? [];
    expect(subscribes).toHaveLength(1);
    expect(screen).toMatch(/if \(!sent \|\| signIn\) return;[\s\S]{0,400}focusManager\.subscribe\(\s*createFocusRecheck\(/);
  });

  test("a status that turns to 'has a password' keeps the email typed for the link", () => {
    expect(screen).toMatch(/<SignInInvite token=\{token\} onExpired=\{markExpired\} defaultEmail=\{knownEmail\}/);
  });
});

describe("B4: a failed password on the invite offers the set-password link", () => {
  test("only a wrong email or password offers it, never a network or rate-limit failure", () => {
    expect(offersSetPasswordLink("auth.login.wrongCredentials")).toBe(true);
    expect(offersSetPasswordLink("errors.network")).toBe(false);
    expect(offersSetPasswordLink("native.tooManyTries")).toBe(false);
    expect(offersSetPasswordLink(null)).toBe(false);
  });

  test("a refused send says why without the server's words", () => {
    expect(setPasswordLinkError({ data: { code: "TOO_MANY_REQUESTS" } })).toBe("native.tooManyTries");
    expect(setPasswordLinkError({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe("errors.network");
    expect(setPasswordLinkError(new TypeError("Network request failed"))).toBe("errors.network");
  });

  test("the sign-in step sends the same neutral link as the no-password step", () => {
    const signInStep = screen.slice(screen.indexOf("function SignInInvite("), screen.indexOf("function NoPasswordInvite("));
    expect(signInStep).toContain("useSetPasswordLink(token)");
    expect(signInStep).toContain("offersSetPasswordLink(");
    expect(signInStep).toContain('t("auth.invite.setPasswordSubmit")');
    expect(signInStep).toContain('t("auth.invite.setPasswordSent")');
    const noPasswordStep = screen.slice(screen.indexOf("function NoPasswordInvite("));
    expect(noPasswordStep).toContain("useSetPasswordLink(token)");
  });
});
