import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { focusManager } from "@tanstack/react-query";

import { needsAnnounce } from "../lib/a11y-policy";
import { appStateFocus } from "../lib/app-focus";
import { createReduceMotionStore } from "../lib/reduce-motion-store";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("announce once (TalkBack read sign-in errors twice)", () => {
  test("Android reads a live region by itself, so text shown in one is not announced again", () => {
    expect(needsAnnounce("android", { shownInLiveRegion: true })).toBe(false);
  });

  test("iOS ignores accessibilityLiveRegion, so VoiceOver still needs the announcement", () => {
    expect(needsAnnounce("ios", { shownInLiveRegion: true })).toBe(true);
  });

  test("text outside a live region is announced everywhere", () => {
    expect(needsAnnounce("android", { shownInLiveRegion: false })).toBe(true);
    expect(needsAnnounce("ios", { shownInLiveRegion: false })).toBe(true);
  });

  test("the sign-in form error goes through the live-region path", () => {
    expect(read("app/(auth)/sign-in.tsx")).toMatch(/announce\(t\(key\), \{ shownInLiveRegion: true \}\)/);
  });
});

/** A stand-in for React Native's AppState. */
function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  return {
    addEventListener(_type: "change", listener: (state: string) => void) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(state: string) {
      for (const l of listeners) l(state);
    },
    get count() {
      return listeners.size;
    },
  };
}

describe("React Query follows the app coming back to the foreground", () => {
  afterEach(() => {
    focusManager.setEventListener(() => () => {});
    focusManager.setFocused(undefined);
  });

  test("background is unfocused, active is focused (stale auth.me and screens refetch on unlock)", () => {
    const appState = fakeAppState();
    focusManager.setEventListener(appStateFocus(appState));
    appState.emit("background");
    expect(focusManager.isFocused()).toBe(false);
    appState.emit("active");
    expect(focusManager.isFocused()).toBe(true);
  });

  test("replacing the listener removes the AppState subscription", () => {
    const appState = fakeAppState();
    focusManager.setEventListener(appStateFocus(appState));
    expect(appState.count).toBe(1);
    focusManager.setEventListener(() => () => {});
    expect(appState.count).toBe(0);
  });

  test("the root layout wires it once", () => {
    expect(read("app/_layout.tsx")).toMatch(/focusManager\.setEventListener\(appStateFocus\(AppState\)\)/);
  });
});

/** A stand-in for React Native's AccessibilityInfo. */
function fakeAccessibilityInfo(initial: boolean) {
  const listeners = new Set<(on: boolean) => void>();
  return {
    isReduceMotionEnabled: async () => initial,
    addEventListener(_type: "reduceMotionChanged", listener: (on: boolean) => void) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(on: boolean) {
      for (const l of listeners) l(on);
    },
    get count() {
      return listeners.size;
    },
  };
}

describe("reduced motion is live (turning it on mid-session stops the press scale)", () => {
  test("reads the system value, then follows changes", async () => {
    const info = fakeAccessibilityInfo(false);
    const store = createReduceMotionStore(info);
    let renders = 0;
    const stop = store.subscribe(() => renders++);
    await tick();
    expect(store.get()).toBe(false);
    info.emit(true);
    expect(store.get()).toBe(true);
    expect(renders).toBeGreaterThan(0);
    stop();
    expect(info.count).toBe(0);
  });

  test("starts from the system value already on", async () => {
    const info = fakeAccessibilityInfo(true);
    const store = createReduceMotionStore(info);
    const stop = store.subscribe(() => {});
    await tick();
    expect(store.get()).toBe(true);
    stop();
  });

  test("PressableScale uses the live hook, not Reanimated's start-up constant", () => {
    const src = read("components/ui/pressable-scale.tsx");
    expect(src).toMatch(/useReduceMotion\(\)/);
    expect(src).not.toMatch(/useReducedMotion/);
  });
});
