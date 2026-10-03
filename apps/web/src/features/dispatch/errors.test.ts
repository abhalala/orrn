import { createI18n } from "@orrn/i18n";
import { describe, expect, test } from "bun:test";

import { dispatchErrorText } from "./errors";

const { t } = createI18n("en");
const err = (code: string, message = "") => ({ message, data: { code } });

describe("dispatchErrorText", () => {
  test("says what happened and what to do, never the server's English", () => {
    expect(dispatchErrorText(t, err("CONFLICT", "Cannot reserve: 2 bundle(s)"))).toBe(
      "Some bundles changed since this page loaded. Check the list and try again.",
    );
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Cannot reserve an empty dispatch"))).toBe("Add at least one bundle first.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Cannot complete an empty dispatch"))).toBe("Add at least one bundle first.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Dispatch transition completed -> reserved is not allowed."))).toBe(
      "This dispatch has moved on. Reload to see where it is now.",
    );
    expect(dispatchErrorText(t, err("FORBIDDEN"))).toBe("Your role can't do this. Ask an admin if you need it.");
    expect(dispatchErrorText(t, err("NOT_FOUND"))).toBe("Not found in this company");
    expect(dispatchErrorText(t, new TypeError("Failed to fetch"))).toBe("No internet connection. Check it and try again.");
    expect(dispatchErrorText(t, err("INTERNAL_SERVER_ERROR"))).toBe("Something went wrong. Try again.");
  });
});
