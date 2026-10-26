import { describe, expect, test } from "bun:test";

import { errorCode, isForbidden, isStaleRefusal, saveMayHaveLanded } from "./errors";

const trpcError = (code: string) => Object.assign(new Error("refused"), { data: { code, httpStatus: 400 } });

describe("purchase error reading", () => {
  test("errorCode reads a tRPC error's code and nothing else", () => {
    expect(errorCode(trpcError("CONFLICT"))).toBe("CONFLICT");
    expect(errorCode(new Error("Failed to fetch"))).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });

  test("a save with no answer from the server may have landed; a refusal did not", () => {
    expect(saveMayHaveLanded(new TypeError("Failed to fetch"))).toBe(true);
    expect(saveMayHaveLanded(trpcError("BAD_REQUEST"))).toBe(false);
    expect(saveMayHaveLanded(trpcError("INTERNAL_SERVER_ERROR"))).toBe(false);
  });

  test("already decided / changed underneath: refresh the screen", () => {
    expect(isStaleRefusal(trpcError("BAD_REQUEST"))).toBe(true);
    expect(isStaleRefusal(trpcError("CONFLICT"))).toBe(true);
    expect(isStaleRefusal(trpcError("FORBIDDEN"))).toBe(false);
    expect(isStaleRefusal(new Error("offline"))).toBe(false);
  });

  test("forbidden is its own state, not a connection problem", () => {
    expect(isForbidden(trpcError("FORBIDDEN"))).toBe(true);
    expect(isForbidden(trpcError("NOT_FOUND"))).toBe(false);
  });
});
