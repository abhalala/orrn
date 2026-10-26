import { describe, expect, test } from "bun:test";

import { applyBarClearance, createToastLift, TOAST_LIFT_VAR, toastLiftAt, toastLiftFor } from "./use-toast-lift";

describe("createToastLift", () => {
  test("the highest bar on screen decides how far toasts lift; none left clears it", () => {
    const applied: (number | null)[] = [];
    const lift = createToastLift((px) => applied.push(px));
    lift.set("a", 90);
    lift.set("b", 140);
    lift.set("a", 100);
    lift.remove("b");
    lift.remove("a");
    expect(applied).toEqual([90, 140, 140, 100, null]);
  });

  test("removing an unknown bar changes nothing", () => {
    const applied: (number | null)[] = [];
    const lift = createToastLift((px) => applied.push(px));
    lift.remove("ghost");
    expect(applied).toEqual([]);
  });
});

describe("toastLiftFor", () => {
  test("a sticky bar's resting bottom plus its height plus a gap, whole pixels", () => {
    expect(toastLiftFor({ stickyBottom: 85, height: 112.4 })).toBe(206);
  });

  test("a bar that is not sticky (bottom auto) still clears its own height", () => {
    expect(toastLiftFor({ stickyBottom: Number.NaN, height: 70 })).toBe(78);
  });
});

describe("toastLiftAt", () => {
  test("a bar resting on its sticky bottom lifts by its resting clearance", () => {
    // viewport 900, bar 68 tall stuck 12 px above the bottom: top = 900 - 12 - 68 = 820.
    expect(toastLiftAt({ stickyBottom: 12, height: 68, top: 820, viewportHeight: 900 })).toBe(88);
  });

  test("scrolled to the page end the bar sits higher, and toasts clear its real top", () => {
    expect(toastLiftAt({ stickyBottom: 12, height: 68, top: 783, viewportHeight: 900 })).toBe(125);
  });

  test("a bar off screen keeps the resting clearance", () => {
    expect(toastLiftAt({ stickyBottom: 12, height: 68, top: -200, viewportHeight: 900 })).toBe(88);
    expect(toastLiftAt({ stickyBottom: 12, height: 68, top: 1200, viewportHeight: 900 })).toBe(88);
  });
});

describe("applyBarClearance", () => {
  function fakeStyle() {
    const props = new Map<string, string>();
    return {
      props,
      setProperty: (k: string, v: string) => void props.set(k, v),
      removeProperty: (k: string) => {
        props.delete(k);
        return "";
      },
    };
  }

  test("lifts toasts and pads the page's scroll end so keyboard focus scrolls clear of the bar (WCAG 2.4.11)", () => {
    const style = fakeStyle();
    applyBarClearance(style, 142);
    expect(style.props.get(TOAST_LIFT_VAR)).toBe("142px");
    expect(style.props.get("scroll-padding-bottom")).toBe("142px");
  });

  test("no bar left clears both", () => {
    const style = fakeStyle();
    applyBarClearance(style, 142);
    applyBarClearance(style, null);
    expect(style.props.size).toBe(0);
  });
});
