import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";

import { afterSignInWith, SIGN_OUT_WAIT_MS, signOutWith } from "../lib/sign-out-flow";

const ROOT = join(import.meta.dir, "..");
const meKey: QueryKey = [["auth", "me"], { type: "query" }];
const bundlesKey: QueryKey = [["bundle", "list"], { input: { limit: 20 }, type: "query" }];

function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(meKey, { company: { id: "c1" } });
  qc.setQueryData(bundlesKey, ["b1", "b2"]);
  return qc;
}

/**
 * A fake device: the Expo plugin wipes the stored cookie the moment sign-out
 * starts (before the request), and the gate reads "is a cookie stored".
 */
function fakeDevice(request: () => Promise<unknown>) {
  const log: string[] = [];
  let cookie = "better-auth.session_token=abc";
  const qc = seeded();
  const deps = {
    queryClient: qc,
    authSignOut: () => {
      cookie = "";
      log.push("request");
      return request();
    },
    presence: {
      changed: () => {
        log.push(`gate:${cookie ? "signed-in" : "signed-out"}:cache-${qc.getQueryData(bundlesKey) ? "kept" : "empty"}`);
      },
    },
  };
  return { log, qc, deps };
}

describe("signOut order: cookie gone, then gate flipped, then cache reset", () => {
  test("with a good network", async () => {
    const { log, qc, deps } = fakeDevice(async () => ({ data: { success: true } }));
    await signOutWith(deps);
    // The gate flips while the cache still holds data: the tabs unmount first,
    // so resetting does not refetch the signed-out person's screens.
    expect(log).toEqual(["request", "gate:signed-out:cache-kept"]);
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
    expect(qc.getQueryData(meKey)).toBeUndefined();
  });

  test("offline (the request fails): still signed out locally, nothing left in the cache", async () => {
    const { log, qc, deps } = fakeDevice(async () => {
      throw new TypeError("Network request failed");
    });
    await signOutWith(deps);
    expect(log).toEqual(["request", "gate:signed-out:cache-kept"]);
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
  });

  test("Wi-Fi with no uplink (the request hangs): the next person gets sign-in within the short wait, not after the OS timeout", async () => {
    const { log, qc, deps } = fakeDevice(() => new Promise(() => {}));
    const started = Date.now();
    await signOutWith({ ...deps, waitMs: 30 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(log).toEqual(["request", "gate:signed-out:cache-kept"]);
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
  });

  test("the reset waits for React to unmount the signed-in screens, so nothing refetches without a cookie", async () => {
    // Seen on the simulator: auth.me went out once more after sign-out and got a 401,
    // because the reset ran before React had committed the gate flip. React applies
    // an external-store change in a microtask (sync lane), unmounting the tabs and
    // disabling the root auth.me query; model exactly that.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const fetched: string[] = [];
    const observe = (key: QueryKey, name: string) => {
      const observer = new QueryObserver(qc, {
        queryKey: key,
        queryFn: async () => {
          fetched.push(name);
          return name;
        },
      });
      const unsubscribe = observer.subscribe(() => {});
      return { observer, unsubscribe };
    };
    qc.setQueryData(meKey, { company: { id: "c1" } });
    qc.setQueryData(bundlesKey, ["b1"]);
    const me = observe(meKey, "auth.me");
    const today = observe(bundlesKey, "bundle.list");

    await signOutWith({
      queryClient: qc,
      authSignOut: async () => ({ data: { success: true } }),
      presence: {
        changed: () =>
          queueMicrotask(() => {
            today.unsubscribe(); // the tabs unmount
            me.observer.setOptions({ queryKey: meKey, enabled: false }); // the gate's auth.me: enabled = hasSession
          }),
      },
    });
    expect(fetched).toEqual([]);
    expect(qc.getQueryData(bundlesKey)).toBeUndefined();
    expect(qc.getQueryData(meKey)).toBeUndefined();
    me.unsubscribe();
  });

  test("the wait is short (about 1.5 s)", () => {
    expect(SIGN_OUT_WAIT_MS).toBeGreaterThan(0);
    expect(SIGN_OUT_WAIT_MS).toBeLessThanOrEqual(2_000);
  });

  test("signOut() in lib/sign-out.ts is signOutWith over the real client, presence and QueryClient", () => {
    const src = readFileSync(join(ROOT, "lib/sign-out.ts"), "utf8");
    expect(src).toMatch(/signOutWith\(\{/);
    expect(src).toMatch(/authClient\.signOut\(\)/);
    expect(src).toMatch(/presence: sessionPresence/);
    expect(src).toMatch(/queryClient[,\s]/);
  });
});

describe("afterSignIn order: drop the previous person's rows, load auth.me, then tell the gate", () => {
  test("happy path", async () => {
    const qc = seeded();
    const log: string[] = [];
    await afterSignInWith({
      queryClient: qc,
      fetchMe: async () => {
        log.push(`fetchMe:bundles-${qc.getQueryData(bundlesKey) ? "kept" : "gone"}`);
      },
      presence: { changed: () => log.push("gate") },
    });
    expect(log).toEqual(["fetchMe:bundles-gone", "gate"]);
  });

  test("auth.me failing still tells the gate (it shows the offline screen and retries)", async () => {
    const log: string[] = [];
    await afterSignInWith({
      queryClient: seeded(),
      fetchMe: async () => {
        throw new Error("offline");
      },
      presence: { changed: () => log.push("gate") },
    });
    expect(log).toEqual(["gate"]);
  });
});
