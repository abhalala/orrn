import { describe, expect, mock, test } from "bun:test";

import {
  createStrongSignInHandler,
  freshSignInNeeded,
  readStrongSignInPlant,
  rememberStrongSignInPlant,
  strongSignInRefusal,
  STRONG_SIGN_IN_PLANT_KEY,
} from "./strong-sign-in";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe("strongSignInRefusal (council r1 A4): the server's reason, never its sentence", () => {
  test("reads both reasons and the plant name", () => {
    expect(strongSignInRefusal({ data: { code: "FORBIDDEN", meta: { reason: "STRONG_SIGN_IN_NEEDED", plant: "Shree Ganesh" } } })).toEqual({
      reason: "STRONG_SIGN_IN_NEEDED",
      plant: "Shree Ganesh",
    });
    expect(strongSignInRefusal({ data: { code: "FORBIDDEN", meta: { reason: "STRONG_METHOD_NEEDED", plant: null } } })).toEqual({
      reason: "STRONG_METHOD_NEEDED",
      plant: null,
    });
  });

  test("any other error is not one", () => {
    expect(strongSignInRefusal({ data: { code: "FORBIDDEN", meta: { reason: "device_revoked" } } })).toBeNull();
    expect(strongSignInRefusal({ data: { code: "BAD_REQUEST", meta: { reason: "STRONG_SIGN_IN_NEEDED" } } })).toBeNull();
    expect(strongSignInRefusal({ message: "This plant needs a passkey", data: { code: "FORBIDDEN" } })).toBeNull();
    expect(strongSignInRefusal(null)).toBeNull();
  });
});

describe("the plant's name for the sign-in page rides in sessionStorage", () => {
  test("remember, read, forget", () => {
    const store = memoryStore();
    rememberStrongSignInPlant("Shree Ganesh", store);
    expect(store.map.get(STRONG_SIGN_IN_PLANT_KEY)).toBe("Shree Ganesh");
    expect(readStrongSignInPlant(store)).toBe("Shree Ganesh");
    rememberStrongSignInPlant(null, store);
    expect(readStrongSignInPlant(store)).toBeNull();
  });

  test("blocked storage never throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberStrongSignInPlant("X", blocked)).not.toThrow();
    expect(readStrongSignInPlant(blocked)).toBeNull();
  });
});

describe("createStrongSignInHandler", () => {
  const deps = () => ({
    signOut: mock(async () => {}),
    toLogin: mock(async () => {}),
    refreshMe: mock(async () => {}),
    toWelcome: mock(async () => {}),
    remember: mock((_: string | null) => {}),
  });

  test("STRONG_SIGN_IN_NEEDED: remembers the plant, signs out once, then the sign-in page", async () => {
    const d = deps();
    const handle = createStrongSignInHandler(d, 0);
    await Promise.all([
      handle({ reason: "STRONG_SIGN_IN_NEEDED", plant: "Shree Ganesh" }),
      handle({ reason: "STRONG_SIGN_IN_NEEDED", plant: "Shree Ganesh" }),
      handle({ reason: "STRONG_SIGN_IN_NEEDED", plant: "Shree Ganesh" }),
    ]);
    expect(d.remember).toHaveBeenCalledWith("Shree Ganesh");
    expect(d.signOut).toHaveBeenCalledTimes(1);
    expect(d.toLogin).toHaveBeenCalledTimes(1);
    expect(d.toWelcome).not.toHaveBeenCalled();
  });

  test("a failed sign-out still goes to the sign-in page", async () => {
    const d = { ...deps(), signOut: mock(async () => Promise.reject(new Error("offline"))) };
    await createStrongSignInHandler(d, 0)({ reason: "STRONG_SIGN_IN_NEEDED", plant: null });
    expect(d.toLogin).toHaveBeenCalledTimes(1);
  });

  test("STRONG_METHOD_NEEDED: reads auth.me again and goes to /welcome, no sign-out", async () => {
    const d = deps();
    await createStrongSignInHandler(d, 0)({ reason: "STRONG_METHOD_NEEDED", plant: null });
    expect(d.refreshMe).toHaveBeenCalledTimes(1);
    expect(d.toWelcome).toHaveBeenCalledTimes(1);
    expect(d.signOut).not.toHaveBeenCalled();
  });
});

describe("freshSignInNeeded (Buddy fix round)", () => {
  test("FORBIDDEN with FRESH_SIGN_IN_NEEDED, and nothing else", () => {
    expect(freshSignInNeeded({ data: { code: "FORBIDDEN", meta: { reason: "FRESH_SIGN_IN_NEEDED" } } })).toBe(true);
    expect(freshSignInNeeded({ data: { code: "FORBIDDEN", meta: { reason: "STRONG_SIGN_IN_NEEDED" } } })).toBe(false);
    expect(freshSignInNeeded({ data: { code: "BAD_REQUEST", meta: { reason: "FRESH_SIGN_IN_NEEDED" } } })).toBe(false);
    expect(freshSignInNeeded(new Error("FRESH_SIGN_IN_NEEDED"))).toBe(false);
    expect(freshSignInNeeded(null)).toBe(false);
  });
});
