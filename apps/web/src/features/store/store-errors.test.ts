import { describe, expect, test } from "bun:test";

import { createI18n, type MessageKey } from "@orrn/i18n";

import { isUnknownOutcome, storeErrorKey, storeErrorText } from "./store-errors";

/** A tRPC client error as the web client sees it: the server's English message and `data.code`. */
function server(code: string, message: string) {
  return { name: "TRPCClientError", message, data: { code, httpStatus: 400 } };
}

/** No answer at all: the browser's own words, no `data`. */
const offline = [
  { name: "TRPCClientError", message: "Failed to fetch", data: undefined },
  { name: "TRPCClientError", message: "Load failed" },
  new TypeError("NetworkError when attempting to fetch resource."),
];

// The server's messages (packages/server/src/routers/store.ts, lib/store.ts), with sample names.
const CASES: [ReturnType<typeof server>, MessageKey][] = [
  [server("CONFLICT", "That store item already exists"), "store.errors.duplicateName"],
  [server("CONFLICT", "An active store item already has that name"), "store.errors.duplicateName"],
  [server("CONFLICT", "This request id was already used for a different entry"), "store.errors.requestReused"],
  [server("BAD_REQUEST", "Only 5 litre of LDO in the store"), "store.errors.short"],
  [
    server("BAD_REQUEST", "Cover flux still has stock; issue or cancel it before retiring the item"),
    "store.errors.retireWithStock",
  ],
  [
    server("BAD_REQUEST", "Cover flux already has store entries; its unit can no longer change"),
    "store.errors.unitLocked",
  ],
  [
    server(
      "BAD_REQUEST",
      "Cannot cancel GRN-4: 25 kg of Cover flux would have to come out, but only 3 is in the store",
    ),
    "store.errors.cancelDrawn",
  ],
  [
    server("BAD_REQUEST", "Cover flux is retired; reactivate it before cancelling GRN-4"),
    "store.errors.cancelItemRetired",
  ],
  [
    server(
      "BAD_REQUEST",
      "Store location STORE of GRN-4 is retired or no longer a store; reactivate it before cancelling",
    ),
    "store.errors.cancelLocationRetired",
  ],
  [server("BAD_REQUEST", "GRN-4 was already cancelled"), "store.errors.alreadyCancelled"],
  [server("BAD_REQUEST", "MRS-12 belongs to a melt; cancel the melt instead"), "store.errors.sourceLocked"],
  [server("BAD_REQUEST", "MRS-12 belongs to another document (press); cancel it there"), "store.errors.sourceLocked"],
  [server("BAD_REQUEST", "Cover flux is retired"), "store.errors.itemRetired"],
  [server("BAD_REQUEST", "Cover flux changed; open it again"), "store.errors.itemChanged"],
  [server("BAD_REQUEST", "The store changed; try again"), "store.errors.storeChanged"],
  [server("BAD_REQUEST", "Add the central store location first (Stock → Locations)"), "store.errors.noLocation"],
  [server("BAD_REQUEST", "More than one central store; retire the extra ones"), "store.errors.manyStores"],
  [server("BAD_REQUEST", "Roller bearing is counted in whole numbers (piece)"), "store.form.qty.whole"],
  // tRPC's raw zod issue list (the server has no error formatter).
  [
    server("BAD_REQUEST", '[{"code":"custom","message":"Name needs letters or digits","path":["name"]}]'),
    "store.errors.nameInvalid",
  ],
  [server("BAD_REQUEST", "Something the screen has never heard of"), "store.errors.refused"],
  [server("NOT_FOUND", "Store entry not found"), "store.errors.notFound"],
  [server("FORBIDDEN", "You don't have permission"), "errors.forbidden"],
  [server("UNAUTHORIZED", "UNAUTHORIZED"), "errors.sessionExpired"],
];

/** The server answered, but with a 5xx: the handler threw after (or while) writing, or a gateway gave up. */
const serverFault = [
  {
    name: "TRPCClientError",
    message: "The exchange was only half saved",
    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
  },
  { name: "TRPCClientError", message: "Gateway timeout", data: { code: "GATEWAY_TIMEOUT", httpStatus: 504 } },
  // No httpStatus, but a code that is a server fault.
  { name: "TRPCClientError", message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } },
];

describe("storeErrorKey: server English becomes an i18n key", () => {
  for (const [error, key] of CASES) {
    test(`${error.data.code} "${error.message.slice(0, 48)}" -> ${key}`, () => {
      expect(storeErrorKey(error)).toBe(key);
      expect(isUnknownOutcome(error)).toBe(false);
    });
  }

  test("no answer from the server is an unknown outcome, never a refusal", () => {
    for (const error of offline) {
      expect(isUnknownOutcome(error)).toBe(true);
      expect(storeErrorKey(error)).toBe("errors.network");
    }
  });

  test("a 5xx answer may have saved the entry (RP18, as T28): unknown outcome, generic text", () => {
    for (const error of serverFault) {
      expect(isUnknownOutcome(error)).toBe(true);
      expect(storeErrorKey(error)).toBe("errors.generic");
    }
  });

  test("junk is a generic message, never a crash", () => {
    expect(storeErrorKey(null)).toBe("errors.network");
    expect(storeErrorKey("boom")).toBe("errors.network");
    expect(storeErrorKey({ data: { code: 42 } })).toBe("errors.generic");
  });
});

describe("storeErrorText never shows the server's words", () => {
  for (const locale of ["en", "hi"] as const) {
    const { t } = createI18n(locale);
    test(`${locale}: every mapped message is a real string with no server English`, () => {
      for (const [error] of CASES) {
        const text = storeErrorText(t, error);
        expect(text.startsWith("store.") || text.startsWith("errors.")).toBe(false);
        expect(text).not.toContain("{");
        expect(text).not.toContain(error.message);
        for (const word of ["Cover flux", "litre", "reactivate", "zod", "custom", "GRN-4"]) {
          expect(text).not.toContain(word);
        }
      }
      for (const error of offline) expect(storeErrorText(t, error)).not.toMatch(/fetch|Load failed/i);
    });
  }

  test("Hindi text is Hindi", () => {
    const { t } = createI18n("hi");
    expect(
      storeErrorText(
        t,
        server("BAD_REQUEST", "Cover flux still has stock; issue or cancel it before retiring the item"),
      ),
    ).toMatch(/[ऀ-ॿ]/);
    expect(storeErrorText(t, offline[0])).toMatch(/[ऀ-ॿ]/);
  });
});
