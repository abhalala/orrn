import { describe, expect, test } from "bun:test";

import type { Me } from "@/shared/lib/me";

import {
  choosePlantSearch,
  clearPlantChosen,
  destinationAfterPick,
  markPlantChosen,
  needsPlantChoice,
  PLANT_CHOSEN_KEY,
  pickerPlants,
  readPlantChosen,
} from "./plant-choice";

type MeOver = Partial<Omit<Me, "user" | "company">> & {
  user?: Partial<Me["user"]>;
  company?: Partial<NonNullable<Me["company"]>> | null;
};

function me(over: MeOver = {}): Me {
  const { user, company, ...rest } = over;
  return {
    user: { id: "u1", name: "Asha", email: "asha@plant.in", onboardingCompleted: true, hasPassword: true, ...user },
    company:
      company === null
        ? null
        : { id: "c1", name: "Fourcubes", slug: "fourcubes", status: "active", plan: null, role: "owner", setupPending: false, ...company },
    memberships: [
      { companyId: "c1", name: "Fourcubes", role: "owner", setupPending: false },
      { companyId: "c2", name: "Ravi Aluminium", role: "admin", setupPending: true },
    ],
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    ...rest,
  } as Me;
}

const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };

/** A Storage stand-in (bun has no sessionStorage). */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe("needsPlantChoice", () => {
  test("more than one plant and nothing picked since this sign-in: true", () => {
    expect(needsPlantChoice(me(), false)).toBe(true);
  });

  test("a plant picked this session: false", () => {
    expect(needsPlantChoice(me(), true)).toBe(false);
  });

  test("one plant (or none listed): false", () => {
    expect(needsPlantChoice(me({ memberships: [{ companyId: "c1", name: "Fourcubes", role: "owner" }] }), false)).toBe(false);
    expect(needsPlantChoice(me({ memberships: [] }), false)).toBe(false);
    expect(needsPlantChoice(me({ memberships: undefined }), false)).toBe(false);
  });

  test("impersonating: false (the banner is the only exit)", () => {
    expect(needsPlantChoice(me({ impersonation: grant }), false)).toBe(false);
  });

  test("no active plant: false (their home explains)", () => {
    expect(needsPlantChoice(me({ company: null }), false)).toBe(false);
  });
});

describe("orrn.plantChosen in session storage", () => {
  test("marked, read and cleared", () => {
    const storage = memoryStorage();
    expect(readPlantChosen(storage)).toBe(false);
    markPlantChosen(storage);
    expect(storage.getItem(PLANT_CHOSEN_KEY)).toBe("1");
    expect(readPlantChosen(storage)).toBe(true);
    clearPlantChosen(storage);
    expect(readPlantChosen(storage)).toBe(false);
  });

  test("blocked or missing storage reads as nothing picked and never throws", () => {
    const blocked = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    expect(readPlantChosen(blocked)).toBe(false);
    expect(() => markPlantChosen(blocked)).not.toThrow();
    expect(() => clearPlantChosen(blocked)).not.toThrow();
    expect(readPlantChosen(null)).toBe(false);
  });
});

describe("pickerPlants", () => {
  test("each plant with its role and whether its setup is pending, in the server's order", () => {
    expect(pickerPlants(me())).toEqual([
      { companyId: "c1", name: "Fourcubes", role: "owner", setupPending: false },
      { companyId: "c2", name: "Ravi Aluminium", role: "admin", setupPending: true },
    ]);
  });

  test("an older auth.me without setupPending lists the plant as set up", () => {
    expect(pickerPlants(me({ memberships: [{ companyId: "c9", name: "Old", role: "packer" }] }))[0]?.setupPending).toBe(false);
  });
});

describe("destinationAfterPick", () => {
  test("a plant whose setup is pending opens its welcome steps", () => {
    expect(destinationAfterPick(me({ company: { id: "c2", setupPending: true, role: "admin" } }))).toBe("/welcome");
  });

  test("a plant that requires secure sign-in, without a strong method: welcome", () => {
    expect(destinationAfterPick(me({ company: { requireStrongSignIn: true } }))).toBe("/welcome");
    expect(destinationAfterPick(me({ company: { requireStrongSignIn: true }, user: { hasPasskey: true } }))).toBe("/today");
  });

  test("a set-up plant: Today, or a same-origin next", () => {
    expect(destinationAfterPick(me())).toBe("/today");
    expect(destinationAfterPick(me(), "/b/26I4086?c=fourcubes")).toBe("/b/26I4086?c=fourcubes");
    expect(destinationAfterPick(me(), "//evil.example")).toBe("/today");
  });

  test("never back to the picker", () => {
    expect(destinationAfterPick(me())).not.toBe("/choose-plant");
  });
});

describe("choosePlantSearch", () => {
  test("keeps only a same-origin next", () => {
    expect(choosePlantSearch({ next: "/orders/1" })).toEqual({ next: "/orders/1" });
    expect(choosePlantSearch({ next: "https://evil.example" })).toEqual({});
    expect(choosePlantSearch({ next: 7 })).toEqual({});
    expect(choosePlantSearch({})).toEqual({});
  });
});
