import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { installDom, settle } from "@/features/buddy/test-dom";
import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import type { DeviceCounts, LabForSubject, WeighView } from "./hooks";

/**
 * XE parity lane DEVICES: the screen and the cards on other screens. With the module off nothing renders and no
 * devices query fires; with it on the cards say what the server computed; a new token is shown once.
 */
const env = installDom("http://localhost/devices");
beforeAll(() => env.install());
afterAll(() => env.uninstall());

type Role = Parameters<typeof testMe>[0];

async function render(node: ReactNode, opts: { role?: Role; modules?: string[]; locale?: "en" | "hi"; seed?: (qc: QueryClient) => void } = {}) {
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
  /** Device queries that are loading or have loaded something from the network (seeded data does not count). */
  const fetching = () => qc.getQueryCache().getAll().filter((x) => x.state.fetchStatus === "fetching").length;
  return { q, cleanup, fetching, text: () => document.body.textContent ?? "" };
}

const WEIGH: WeighView = {
  subject: { type: "purchase_lot", id: "l1", number: "LOT-1", vehicleNo: "GJ01AB1234", weightG: 10_000_000 },
  use: { id: "u1", typedG: null, bridgeG: 10_200_000, reason: null, flagged: false, createdAt: new Date(0) },
  ticket: { id: "r1", deviceId: "d1", kind: "weighbridge", source: "push", seq: 1, simulated: false, sampledAt: new Date(0), receivedAt: new Date(0), skewMs: 0, timeUnconfirmed: false, ticketNo: "T-77", vehicleNo: "GJ01AB1234", grossG: 15_000_000, tareG: 4_800_000, netG: 10_200_000, sampleCode: null, values: {} },
  kanta: { diffG: -200_000, allowedG: 51_000, flagged: true },
  load: null,
  tickets: { sameTruck: [], others: [] },
  tolerance: { bp: 50, minG: 20_000 },
} as never;

const seedWeigh = (qc: QueryClient) => qc.setQueryData(trpc.devices.weigh.forSubject.queryOptions({ subjectType: "purchase_lot", subjectId: "l1" }).queryKey, WEIGH as never);

describe("the module switch", () => {
  test("with plant devices off the screen says so and shows no tabs", async () => {
    const { DevicesScreen } = await import("./devices-screen");
    const view = await render(<DevicesScreen search={{}} onSearch={() => {}} />, { modules: ["press", "bundles"] });
    try {
      expect(view.q("dev3-module-off")?.textContent).toBe("Plant devices are off for this plant. Ask orrn support to turn them on.");
      expect(view.q("dev3-tab-devices")).toBeNull();
      expect(view.fetching()).toBe(0);
    } finally {
      await view.cleanup();
    }
  });

  test("an empty module list means off too: devices is opt-in", async () => {
    const { DevicesScreen } = await import("./devices-screen");
    const view = await render(<DevicesScreen search={{}} onSearch={() => {}} />, { modules: [] });
    try {
      expect(view.q("dev3-module-off")).not.toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("the weigh card, the lab card and the Today tile render nothing and ask nothing with the module off", async () => {
    const { WeighCard } = await import("./weigh-card");
    const { LabResultsCard, TodayDevicesTile } = await import("./flags");
    const view = await render(
      <>
        <WeighCard subjectType="purchase_lot" subjectId="l1" closed={false} />
        <LabResultsCard pressRunId="r1" />
        <TodayDevicesTile />
      </>,
      { role: "owner", modules: ["press"], seed: seedWeigh },
    );
    try {
      expect(view.q("dev3-weigh-card-purchase_lot")).toBeNull();
      expect(view.q("dev3-lab-card")).toBeNull();
      expect(view.q("today-devices")).toBeNull();
      expect(view.fetching()).toBe(0);
    } finally {
      await view.cleanup();
    }
  });

  test("the cards render nothing for a role with no device or weighing action, even with the module on", async () => {
    const { WeighCard } = await import("./weigh-card");
    const { TodayDevicesTile } = await import("./flags");
    const view = await render(
      <>
        <WeighCard subjectType="purchase_lot" subjectId="l1" closed={false} />
        <TodayDevicesTile />
      </>,
      { role: "viewer", modules: ["devices"], seed: seedWeigh },
    );
    try {
      expect(view.q("dev3-weigh-card-purchase_lot")).toBeNull();
      expect(view.q("today-devices")).toBeNull();
      expect(view.fetching()).toBe(0);
    } finally {
      await view.cleanup();
    }
  });
});

describe("cards with the module on", () => {
  test("a lot's weigh shows the ticket, the kanta flag in the plant's unit, and the pick and type buttons", async () => {
    const { WeighCard } = await import("./weigh-card");
    const view = await render(<WeighCard subjectType="purchase_lot" subjectId="l1" closed={false} />, { role: "office", modules: ["devices"], seed: seedWeigh });
    try {
      expect(view.q("dev3-weigh-live")?.textContent).toContain("Ticket T-77, net 10,200.000 kg");
      expect(view.q("dev3-kanta-flag")?.textContent).toBe("Differs from the bridge by 200.000 kg, more than the allowed 51.000 kg");
      expect(view.q("dev3-type-open")).not.toBeNull();
      expect(view.text()).not.toContain("{massUnit}");
    } finally {
      await view.cleanup();
    }
  });

  test("a closed lot or a completed load keeps the weigh but loses the pick and type actions", async () => {
    const { WeighCard } = await import("./weigh-card");
    const view = await render(<WeighCard subjectType="purchase_lot" subjectId="l1" closed />, { role: "office", modules: ["devices"], seed: seedWeigh });
    try {
      expect(view.q("dev3-weigh-live")).not.toBeNull();
      expect(view.q("dev3-weigh-actions")).toBeNull();
      expect(view.q("dev3-type-open")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("a person who cannot weigh (storekeeper reads devices only on a dispatch) gets no type button on a load", async () => {
    const { WeighCard } = await import("./weigh-card");
    const view = await render(<WeighCard subjectType="dispatch" subjectId="d1" closed={false} />, {
      role: "storekeeper",
      modules: ["devices"],
      seed: (qc) =>
        qc.setQueryData(trpc.devices.weigh.forSubject.queryOptions({ subjectType: "dispatch", subjectId: "d1" }).queryKey, {
          ...WEIGH,
          subject: { ...WEIGH.subject, type: "dispatch", id: "d1" },
          kanta: null,
          load: { diffG: 500_000, allowedG: 51_000, flagged: true },
        } as never),
    });
    try {
      expect(view.q("dev3-load-check")?.textContent).toContain("Differs by 500.000 kg, more than the allowed 51.000 kg");
      expect(view.q("dev3-type-open")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("the lab card counts what is out of tolerance, and a simulated or empty card says so plainly", async () => {
    const { LabResultsCardBody } = await import("./flags");
    const data: LabForSubject = { items: [{ id: "c1", kind: "dimension", result: "fail", number: "PR-12", flagged: ["Wall"], deviceCode: "SCAN-1", checkedAt: new Date(0) }], outOfTolerance: 1 } as never;
    const view = await render(<LabResultsCardBody data={data} />);
    try {
      expect(view.q("dev3-lab-count")?.textContent).toBe("1 out of tolerance");
      expect(view.text()).toContain("from SCAN-1");
      expect(view.text()).toContain("Out: Wall");
    } finally {
      await view.cleanup();
    }
    const empty = await render(<LabResultsCardBody data={{ items: [], outOfTolerance: 0 } as never} />);
    try {
      expect(empty.text()).toContain("No device results on this yet.");
    } finally {
      await empty.cleanup();
    }
  });

  test("the Today tile links to /devices and counts live, late and silent", async () => {
    const { TodayDevicesTileBody } = await import("./flags");
    const data: DeviceCounts = { live: 2, late: 1, silent: 0, never: 0, revoked: 0, simulated: 1, total: 3 };
    const view = await render(<TodayDevicesTileBody data={data} />);
    try {
      expect(view.q("today-devices")).not.toBeNull();
      expect(view.text()).toContain("2 live, 1 late, 0 silent");
      expect(view.text()).toContain("1 simulated");
      expect(document.querySelector("a[href='/devices']")).not.toBeNull();
    } finally {
      await view.cleanup();
    }
  });
});

describe("the token is shown once", () => {
  test("the sheet shows the token with the shown-once note, and nothing at all once it is dropped", async () => {
    const { TokenSheet } = await import("./token-box");
    const view = await render(<TokenSheet code="WB-1" token="odv_abc123" onDone={() => {}} />);
    try {
      expect(view.q("dev3-token")?.textContent).toBe("odv_abc123");
      expect(view.q("dev3-token-note")?.textContent).toBe("Shown once. Copy it to the edge box now. It cannot be shown again.");
      expect(view.text()).toContain("Token for WB-1");
    } finally {
      await view.cleanup();
    }
    const gone = await render(<TokenSheet code="WB-1" token={null} onDone={() => {}} />);
    try {
      expect(gone.q("dev3-token")).toBeNull();
      expect(gone.text()).not.toContain("odv_abc123");
    } finally {
      await gone.cleanup();
    }
  });

  test("Hindi says the same, with the token still intact", async () => {
    const { TokenSheet } = await import("./token-box");
    const view = await render(<TokenSheet code="WB-1" token="odv_abc123" onDone={() => {}} />, { locale: "hi" });
    try {
      expect(view.q("dev3-token")?.textContent).toBe("odv_abc123");
      expect(view.q("dev3-token-note")?.textContent).toContain("एक ही बार");
    } finally {
      await view.cleanup();
    }
  });
});

describe("the import tab", () => {
  test("a weighbridge file needs a unit and a device picked, and only a device manager sees it", async () => {
    const { ImportTab } = await import("./import-tab");
    const list = { devices: [{ id: "d1", code: "WB-1", label: "Gate bridge", kind: "weighbridge", revokedAt: null }], sources: [], counts: {} };
    const seed = (qc: QueryClient) => qc.setQueryData(trpc.devices.list.queryOptions().queryKey, list as never);
    const manager = await render(<ImportTab />, { role: "manager", modules: ["devices"], seed });
    try {
      expect(manager.q("dev3-import-wb")).not.toBeNull();
      const unit = document.querySelector<HTMLSelectElement>("[data-testid='dev3-import-unit']")!;
      expect(unit.value).toBe("");
      expect(Array.from(unit.options).map((o) => o.value)).toEqual(["", "kg", "t"]);
      expect(document.querySelector<HTMLSelectElement>("[data-testid='dev3-import-device']")!.value).toBe("");
    } finally {
      await manager.cleanup();
    }
    const office = await render(<ImportTab />, { role: "office", modules: ["devices"], seed });
    try {
      expect(office.q("dev3-import-wb")).toBeNull();
    } finally {
      await office.cleanup();
    }
  });
});

describe("the lab tab", () => {
  const inbox = {
    items: [{ id: "m1", deviceId: "d2", kind: "mechanical", source: "file", seq: null, simulated: false, sampledAt: new Date(0), receivedAt: new Date(0), skewMs: 0, timeUnconfirmed: false, ticketNo: null, vehicleNo: null, grossG: null, tareG: null, netG: null, sampleCode: "RUN-12", values: { tensileMpa: 215, yieldMpa: 180, elongationX10: 85 } }],
    nextCursor: null,
    spectro: [],
  };
  const seed = (qc: QueryClient) => qc.setQueryData(trpc.devices.lab.inbox.queryOptions({ limit: 100 }).queryKey, inbox as never);

  test("Attach writes a quality check, so it needs the quality module; Set aside does not", async () => {
    const { LabTab } = await import("./lab-tab");
    const withQa = await render(<LabTab />, { role: "manager", modules: ["devices", "qa"], seed });
    try {
      expect(withQa.q("dev3-attach-m1")).not.toBeNull();
      expect(withQa.q("dev3-aside-m1")).not.toBeNull();
      expect(withQa.text()).toContain("RUN-12");
    } finally {
      await withQa.cleanup();
    }
    const noQa = await render(<LabTab />, { role: "manager", modules: ["devices"], seed });
    try {
      expect(noQa.q("dev3-attach-m1")).toBeNull();
      expect(noQa.q("dev3-aside-m1")).not.toBeNull();
    } finally {
      await noQa.cleanup();
    }
  });
});
