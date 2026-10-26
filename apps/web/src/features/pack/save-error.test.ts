import { TRPCClientError } from "@trpc/client";
import { describe, expect, test } from "bun:test";

import { saveErrorKind } from "./save-error";

/** A tRPC error answer as the client sees it. */
const answer = (code: string, message: string, httpStatus = 400) =>
  Object.assign(new Error(message), { data: { code, httpStatus } });

describe("saveErrorKind (what a failed createReceipt tells the packer)", () => {
  test("a role without bundle.pack", () => {
    expect(saveErrorKind(answer("FORBIDDEN", "Insufficient permissions", 403))).toBe("forbidden");
  });

  test("a yard retired or removed since the yards loaded is a yard problem", () => {
    // bundle.ts: "Location X is retired" (BAD_REQUEST) and "Location not found" (NOT_FOUND).
    expect(saveErrorKind(answer("BAD_REQUEST", "Location Y3 is retired"))).toBe("yard");
    expect(saveErrorKind(answer("NOT_FOUND", "Location not found", 404))).toBe("yard");
    expect(saveErrorKind(answer("BAD_REQUEST", "Choose the yard (locationId) for these bundles"))).toBe("yard");
  });

  test("no answer from orrn (connection dropped): the session may have saved", () => {
    expect(saveErrorKind(new TypeError("Failed to fetch"))).toBe("unsure");
    expect(saveErrorKind(TRPCClientError.from(new TypeError("Failed to fetch")))).toBe("unsure");
  });

  test("a server or gateway failure (5xx) is unsure too", () => {
    expect(saveErrorKind(answer("INTERNAL_SERVER_ERROR", "D1_ERROR", 500))).toBe("unsure");
    expect(saveErrorKind(answer("GATEWAY_TIMEOUT", "timeout", 504))).toBe("unsure");
  });

  test("any other refusal did not save", () => {
    expect(saveErrorKind(answer("BAD_REQUEST", "Die not found"))).toBe("failed");
    expect(saveErrorKind(answer("NOT_FOUND", "Die not found", 404))).toBe("failed");
    expect(saveErrorKind(answer("CONFLICT", "Serial taken", 409))).toBe("failed");
  });
});
