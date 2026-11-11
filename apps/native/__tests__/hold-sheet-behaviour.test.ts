import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createI18n } from "@orrn/i18n";

import { orderErrorLines } from "../features/orders/order-model";

let currentMe: unknown = null;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
mock.module("react-native", () => require("react-native-web"));
mock.module("@expo/vector-icons/Feather", () => ({ default: () => null }));
mock.module("@/components/ui/pressable-scale", () => ({
  PressableScale: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(require("react-native-web").Pressable, props, children),
}));
mock.module("@/lib/theme", () => ({ useThemeColor: () => "#000000" }));
mock.module("@/utils/me", () => ({
  ...require("@orrn/server/lib/permissions"),
  useMe: () => ({ data: currentMe }),
}));
mock.module("@/utils/trpc", () => ({ trpc: {} }));

const target = { lineId: "line-1", lineNo: 2, orderNumber: "SO-14", sectionId: "die-1", cutLengthMm: 3658, customerId: "customer-1" };

beforeEach(() => {
  currentMe = null;
});

describe("hold and release action rendering", () => {
  test("a person without order.manage cannot see Hold stock or Held bundles", async () => {
    const { HoldActions } = await import("../features/orders/hold-ui");
    const props = { target, openOrder: true, heldG: 12_000, heldBundles: 1, onHold: () => {}, onHeld: () => {} };
    currentMe = { company: { role: "operator" } };
    const forbidden = renderToStaticMarkup(React.createElement(HoldActions, props));
    expect(forbidden).not.toContain("Hold stock");
    expect(forbidden).not.toContain("Held bundles");

    currentMe = { company: { role: "owner" } };
    const allowed = renderToStaticMarkup(React.createElement(HoldActions, props));
    expect(allowed).toContain("Hold stock");
    expect(allowed).toContain("Held bundles");
  });
});

describe("hold sheet refusal rendering", () => {
  test("the shared server refusal message is visible inside the sheet error component", async () => {
    const { SheetErrors } = await import("../features/orders/hold-ui");
    const t = createI18n("en").t;
    const error = { message: "26J101 is dispatched; only bundles in the yard can be held", data: { code: "BAD_REQUEST", httpStatus: 400 } };
    const lines = orderErrorLines(t, error);
    const html = renderToStaticMarkup(React.createElement(SheetErrors, { lines }));
    expect(html).toContain("26J101 is not in the yard. Only bundles in the yard can be held.");
    expect(html).toContain("alert");
  });
});
