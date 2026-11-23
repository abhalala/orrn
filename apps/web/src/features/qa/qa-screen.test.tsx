import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { installDom, settle } from "@/features/buddy/test-dom";
import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import type { QaCheckRow, QaHoldRow, QaLineAlloy, QaRunView, QaToday } from "./hooks";

/**
 * XE parity lane QA: the quality screen renders from the server's rows (seeded into the query cache):
 * the hold list and who may release, a register row with its flags, the module switch, and the flags
 * on Today, the press station and the order line, in en and hi.
 */
const env = installDom("http://localhost/qa");
beforeAll(() => env.install());
afterAll(() => env.uninstall());

type Role = Parameters<typeof testMe>[0];

const HOLD: QaHoldRow = {
  id: "h1",
  bundleId: "b1",
  serial: "26J12",
  sectionCode: "1234",
  weightG: 152_500,
  bundleStatus: "available",
  reason: "Dent on the face",
  heldBy: "Asha",
  heldAt: Date.UTC(2026, 10, 20, 6, 0),
  releasedBy: null,
  releasedAt: null,
  releaseNote: null,
};

const CHECK: QaCheckRow = {
  id: "c1",
  kind: "dimension",
  subjectType: "press_run",
  subjectId: "r1",
  subjectNumber: "PR-12",
  pressRunId: "r1",
  bundleId: null,
  stage: null,
  station: "P1",
  result: "fail",
  values: {},
  flags: { flagged: ["Wall"] },
  standard: null,
  operatorName: null,
  note: null,
  checkedBy: "Ravi",
  checkedAt: Date.UTC(2026, 10, 20, 7, 0),
};

async function render(node: ReactNode, opts: { role?: Role; modules?: string[]; locale?: "en" | "hi" | "gu"; seed?: (qc: QueryClient) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, testMe(opts.role ?? "manager", { modules: opts.modules ?? [] }) as never);
  opts.seed?.(qc);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale={opts.locale ?? "en"}>{node}</I18nProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid='${id}']`);
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  };
  return { q, cleanup, text: () => document.body.textContent ?? "" };
}

const seedHolds = (qc: QueryClient) => qc.setQueryData(trpc.qa.holds.list.queryOptions({ open: true, limit: 100 }).queryKey, { items: [HOLD], nextCursor: null } as never);

describe("/qa On hold (row 29)", () => {
  test("a supervisor sees the held bundle with its reason, and can hold and release", async () => {
    const { QaScreen } = await import("./qa-screen");
    const view = await render(<QaScreen search={{ tab: "holds" }} onSearch={() => {}} />, { role: "supervisor", seed: seedHolds });
    try {
      expect(view.q("qa-tab-holds")).not.toBeNull();
      expect(view.text()).toContain("26J12");
      expect(view.text()).toContain("Dent on the face");
      expect(view.text()).toContain("Held by Asha");
      expect(view.q("qa-release-26J12")).not.toBeNull();
      expect(view.q("qa-hold-open")).not.toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("a viewer reads the list but gets neither Hold nor Release", async () => {
    const { QaScreen } = await import("./qa-screen");
    const view = await render(<QaScreen search={{ tab: "holds" }} onSearch={() => {}} />, { role: "viewer", seed: seedHolds });
    try {
      expect(view.text()).toContain("26J12");
      expect(view.q("qa-release-26J12")).toBeNull();
      expect(view.q("qa-hold-open")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("with quality off for the plant the screen says so and shows no tabs", async () => {
    const { QaScreen } = await import("./qa-screen");
    const view = await render(<QaScreen search={{ tab: "holds" }} onSearch={() => {}} />, { modules: ["press", "bundles"], seed: seedHolds });
    try {
      expect(view.q("qa-module-off")?.textContent).toBe("Quality is off for this plant. Ask orrn support to turn it on.");
      expect(view.q("qa-tab-holds")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });
});

describe("/qa Checks (rows 22 to 27, 39)", () => {
  const seed = (qc: QueryClient) => qc.setQueryData(trpc.qa.checks.list.queryOptions({ limit: 50, cursor: 0, kind: "dimension" }).queryKey, { items: [CHECK], nextCursor: null } as never);

  test("the dimension register shows the run, the server's verdict and what is out of tolerance", async () => {
    const { QaScreen } = await import("./qa-screen");
    const view = await render(<QaScreen search={{ tab: "checks", kind: "dimension" }} onSearch={() => {}} />, { seed });
    try {
      expect(view.text()).toContain("PR-12");
      expect(document.querySelector("[data-result='fail']")?.textContent).toBe("Fail");
      expect(view.text()).toContain("Out of tolerance: Wall");
      expect(view.q("qa-record-open")).not.toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("in Hindi the register speaks Hindi", async () => {
    const { QaScreen } = await import("./qa-screen");
    const { hi } = await import("@orrn/i18n/hi");
    const view = await render(<QaScreen search={{ tab: "checks", kind: "dimension" }} onSearch={() => {}} />, { seed, locale: "hi" });
    try {
      expect(view.text()).toContain(hi.qa.result.fail);
      expect(view.text()).toContain(hi.qa.kind.dimension);
      expect(view.text()).not.toContain("Out of tolerance");
    } finally {
      await view.cleanup();
    }
  });
});

describe("quality flags on other screens", () => {
  test("Today names the overdue instruments and the bundles on hold (row 38)", async () => {
    const { TodayQaTileBody } = await import("./flags");
    const data: QaToday = { moduleOn: true, onHold: 2, overdue: [{ id: "i1", code: "VC-01", name: "Vernier", nextDueOn: "2026-11-01" }], dueSoon: 1 };
    const view = await render(<TodayQaTileBody data={data} />);
    try {
      expect(view.q("today-qa")).not.toBeNull();
      expect(view.text()).toContain("VC-01");
      expect(view.text()).toContain("2 on quality hold");
      expect(view.text()).toContain("1 due within 7 days");
    } finally {
      await view.cleanup();
    }
  });

  test("Today shows nothing to a person without a quality role", async () => {
    const { TodayQaTile } = await import("./flags");
    const view = await render(<TodayQaTile />, {
      role: "viewer",
      seed: (qc) => qc.setQueryData(trpc.qa.today.queryOptions().queryKey, { moduleOn: true, onHold: 3, overdue: [], dueSoon: 0 } as never),
    });
    try {
      expect(view.q("today-qa")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("an order line short of its alloy lists the substitutes with the plant's mass unit (row 37)", async () => {
    const { OrderLineAlloyBody } = await import("./flags");
    const data: QaLineAlloy = { alloy: "6063", needG: 1_200_000, onHandG: 300_000, short: true, substitutes: [{ alloy: "6060", onHandG: 2_000_000, note: null }] };
    const view = await render(<OrderLineAlloyBody data={data} />);
    try {
      const text = view.q("qa-alloy-short")?.textContent ?? "";
      expect(text).toContain("Alloy short");
      expect(text).toContain("6063:");
      expect(text).toContain("kg of billets for");
      expect(view.q("qa-alloy-substitutes")?.textContent).toContain("6060 (");
      expect(text).not.toContain("{massUnit}");
    } finally {
      await view.cleanup();
    }
  });

  test("the press station says a failed first piece and a due check, with a link to the run's quality", async () => {
    const { RunQualityFlagBody } = await import("./flags");
    const data = {
      run: { id: "r1", number: "PR-12", status: "running", sectionId: "s1", dieInstanceId: "d1" },
      firstPiece: { id: "c1", result: "fail", checkedAt: 0 },
      firstPieceState: "failed",
      firstPieceBlocksPack: true,
      inProcess: [],
      inProcessDue: { due: true, reason: "bundles", everyBundles: 5, everyMinutes: null, bundlesSince: 6 },
      plan: null,
      breaches: [],
    } as unknown as QaRunView;
    const view = await render(<RunQualityFlagBody data={data} />);
    try {
      const text = view.q("qa-run-flag")?.textContent ?? "";
      expect(text).toContain("The first piece of PR-12 failed; check a new piece first");
      expect(text).toContain("A check is due: 6 bundles since the last one.");
      expect(view.q("qa-run-flag")?.querySelector("a")?.getAttribute("href")).toBe("/qa?tab=checks&run=r1");
    } finally {
      await view.cleanup();
    }
  });
});
