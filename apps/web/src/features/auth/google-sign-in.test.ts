import { describe, expect, test } from "bun:test";

import { PLANT_CHOSEN_KEY } from "@/shared/lib/plant-chosen";

import { googleSignInUrls, startGoogleSignIn } from "./google-sign-in";

const ORIGIN = "https://orrn.in";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    has: (k: string) => map.has(k),
  };
}

describe("googleSignInUrls", () => {
  test("Google comes back to the sign-in page, which finishes the sign-in; a refusal lands there with ?error=", () => {
    expect(googleSignInUrls(ORIGIN)).toEqual({
      callbackURL: "https://orrn.in/login?via=google",
      errorCallbackURL: "https://orrn.in/login",
    });
  });

  test("the page the person signed in for rides along both ways", () => {
    const urls = googleSignInUrls(ORIGIN, "/orders/42?tab=lines");
    expect(new URL(urls.callbackURL).searchParams.get("next")).toBe("/orders/42?tab=lines");
    expect(new URL(urls.callbackURL).searchParams.get("via")).toBe("google");
    expect(new URL(urls.errorCallbackURL).searchParams.get("next")).toBe("/orders/42?tab=lines");
  });

  test("an off-site or unsafe next is dropped, never carried to the callback", () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil.example", "/login"]) {
      expect(googleSignInUrls(ORIGIN, bad)).toEqual(googleSignInUrls(ORIGIN));
    }
  });
});

describe("startGoogleSignIn", () => {
  test("forgets this tab's plant pick before leaving for Google, so a person in several plants picks again", async () => {
    const storage = memoryStorage({ [PLANT_CHOSEN_KEY]: "1" });
    const calls: { chosenWhenCalled: boolean; body: unknown }[] = [];
    const error = await startGoogleSignIn(
      async (body) => {
        calls.push({ chosenWhenCalled: storage.has(PLANT_CHOSEN_KEY), body });
        return { data: { url: "https://accounts.google.com/o/oauth2" }, error: null };
      },
      { origin: ORIGIN, next: "/stock", storage },
    );
    expect(error).toBeNull();
    expect(storage.has(PLANT_CHOSEN_KEY)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.chosenWhenCalled).toBe(false);
    expect(calls[0]!.body).toEqual({ provider: "google", ...googleSignInUrls(ORIGIN, "/stock") });
  });

  test("a failed start (network, server) comes back as the error to show", async () => {
    const error = await startGoogleSignIn(async () => ({ data: null, error: { status: 0 } }), {
      origin: ORIGIN,
      storage: memoryStorage(),
    });
    expect(error).toEqual({ status: 0 });
    const thrown = await startGoogleSignIn(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      { origin: ORIGIN, storage: memoryStorage() },
    );
    expect(thrown).toBeInstanceOf(TypeError);
  });
});
