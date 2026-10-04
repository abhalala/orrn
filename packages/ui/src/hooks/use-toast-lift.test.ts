import { describe, expect, test } from "bun:test";

import { createToastLift, toastLiftFor } from "./use-toast-lift";

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
