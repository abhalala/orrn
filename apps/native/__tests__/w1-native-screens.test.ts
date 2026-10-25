import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("W1-NATIVE-A screens exist", () => {
  const screens = [
    "app/(tabs)/dies/_layout.tsx",
    "app/(tabs)/dies/index.tsx",
    "app/(tabs)/dies/[id].tsx",
    "app/(tabs)/press/_layout.tsx",
    "app/(tabs)/press/index.tsx",
    "app/(tabs)/orders/_layout.tsx",
    "app/(tabs)/orders/index.tsx",
    "app/(tabs)/orders/new.tsx",
    "app/(tabs)/orders/[id].tsx",
    "app/(tabs)/menu.tsx",
    "components/release-gate.tsx",
  ];
  for (const s of screens) {
    test(s, () => expect(existsSync(join(ROOT, s))).toBe(true));
  }

  test("Maestro flows are written (untested on a device)", () => {
    for (const f of ["die-room", "orders-office", "release-gate"]) expect(existsSync(join(ROOT, "..", "..", ".maestro", "flows", `${f}.yaml`))).toBe(true);
  });
});

describe("die room procedures (shapes from the dieInstance routers)", () => {
  test("the card reads dieInstance.get and writes through the die room procedures", () => {
    expect(read("features/dies/copy-card.tsx")).toMatch(/trpc\.dieInstance\.get\.queryOptions/);
    expect(read("features/dies/reading-panel.tsx")).toMatch(/trpc\.dieInstance\.addReading\.mutationOptions/);
    const nit = read("features/dies/nitriding-panel.tsx");
    expect(nit).toMatch(/trpc\.dieInstance\.nitridingOut\.mutationOptions/);
    expect(nit).toMatch(/trpc\.dieInstance\.nitridingBack\.mutationOptions/);
    const issue = read("features/dies/issue-panel.tsx");
    for (const p of ["issue", "return", "cancel", "queuedRuns", "pressLines"]) expect(issue).toContain(`trpc.dieInstance.issues.${p}.`);
    const maker = read("features/dies/maker-panel.tsx");
    for (const p of ["send", "receive", "cancel"]) expect(maker).toContain(`trpc.dieInstance.maker.jobs.${p}.mutationOptions`);
    expect(read("features/dies/copy-card.tsx")).toMatch(/trpc\.dieInstance\.files\.url\.queryOptions/);
  });

  test("the phone never sends a derived number: a reading is only the typed weight", () => {
    const reading = read("features/dies/reading-panel.tsx");
    expect(reading).toMatch(/add\.mutateAsync\(\{ dieInstanceId: copyId, kgPer12ftMilli: milli \}\)/);
  });

  test("a failed save keeps what was typed: the keypad is cleared only after the server answered", () => {
    const reading = read("features/dies/reading-panel.tsx");
    const tryBlock = reading.slice(reading.indexOf("try {"), reading.indexOf("} catch"));
    const catchBlock = reading.slice(reading.indexOf("} catch"));
    expect(tryBlock).toMatch(/await add\.mutateAsync[\s\S]*setText\(""\)/);
    expect(catchBlock).not.toMatch(/setText\(""\)/);
  });

  test("buttons follow the permission matrix: die.reading, die.card, die.issue, die.maker", () => {
    const card = read("features/dies/copy-card.tsx");
    expect(card).toMatch(/copyAbilities\(status, \(action\) => can\(me, action\)\)/);
    expect(card).toMatch(/can\(me, "die\.issue"\)/);
  });

  test("engineering fields are read only: the card has no input for them", () => {
    const card = read("features/dies/copy-card.tsx");
    expect(card).not.toMatch(/<(Field|NumberInput|TextInput)\b/);
    expect(card).toMatch(/native\.dies\.readOnly/);
  });

  test("files open through the signed URL", () => {
    expect(read("features/dies/copy-card.tsx")).toMatch(/Linking\.openURL\(signed\.url\)/);
  });

  test("the Dies tab reads copies from dieInstance.list", () => {
    expect(read("features/dies/use-attention.ts")).toMatch(/trpc\.dieInstance\.list\.queryOptions/);
    expect(read("features/dies/dies-view.tsx")).toMatch(/rankAttention/);
  });

  test("scan: a copy code or card link opens the card, in lookup mode only", () => {
    const scan = read("features/scan/scan-view.tsx");
    expect(scan).toMatch(/modeRef\.current\.kind === "lookup" && diesRef\.current && \(await openDieCopy\(id, raw\)\)/);
    expect(scan).toMatch(/pathname: "\/dies\/\[id\]"/);
  });
});

describe("orders procedures", () => {
  test("list, detail, booking and confirm use the orders router", () => {
    expect(read("features/orders/orders-view.tsx")).toMatch(/trpc\.orders\.list\.queryOptions/);
    expect(read("features/orders/orders-view.tsx")).toMatch(/lateLabel\(o\.lateDays, t\)/);
    const detail = read("features/orders/order-detail.tsx");
    expect(detail).toMatch(/trpc\.orders\.get\.queryOptions/);
    expect(detail).toMatch(/trpc\.orders\.confirm\.mutationOptions/);
    expect(detail).toMatch(/stripCells\(strip\)/);
    expect(detail).toMatch(/orderErrorLines\(t, e\)/);
    const form = read("features/orders/booking-screen.tsx");
    expect(form).toMatch(/trpc\.orders\.quote\.queryOptions/);
    expect(form).toMatch(/trpc\.orders\.create\.mutationOptions/);
  });

  test("confirm is shown to order.manage only and waits while blockers remain", () => {
    const detail = read("features/orders/order-detail.tsx");
    expect(detail).toMatch(/<Can do="order\.manage">[\s\S]*orders\.confirm/);
    expect(detail).toMatch(/disabled=\{blockers\.length > 0\}/);
    expect(read("features/orders/orders-view.tsx")).toMatch(/<Can do="order\.manage">/);
    expect(read("features/orders/booking-screen.tsx")).toMatch(/can\(me, "order\.manage"\)/);
  });

  test("the booking form does not clear on a failed save and replays safely", () => {
    const form = read("features/orders/booking-screen.tsx");
    const tryBlock = form.slice(form.indexOf("const done = await create.mutateAsync"), form.indexOf("} catch (e)"));
    expect(tryBlock).not.toMatch(/setDraft|newDraft/);
    const catchBlock = form.slice(form.indexOf("} catch (e)"), form.indexOf("} catch (e)") + 200);
    expect(catchBlock).not.toMatch(/setDraft|newDraft/);
    expect(form).toMatch(/clientRequestId: sent\.id/);
  });

  test("no plan board on the phone", () => {
    expect(existsSync(join(ROOT, "app/(tabs)/orders/plan.tsx"))).toBe(false);
    expect(read("features/orders/orders-view.tsx")).not.toMatch(/plans\./);
  });
});

describe("hidden-but-reachable tabs (Orders and Dies from More)", () => {
  test("the tabs layout opens every reachable route; the bar draws only the person's own set", () => {
    expect(read("app/(tabs)/_layout.tsx")).toMatch(/new Set\(reachableTabs\(me\)\)/);
    expect(read("components/tab-bar.tsx")).toMatch(/const onBar = new Set\(visibleTabs\(me\)\)/);
  });

  test("the Dies list reads the new latestReadAt column from the server", () => {
    expect(read("features/dies/dies-view.tsx")).toMatch(/latestReadAt/);
  });
});
