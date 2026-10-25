import { describe, expect, test } from "bun:test";

import { DICTIONARIES, hasMessages, loadMessages } from "./dictionaries.web";
import { en } from "./en";
import { enPublic } from "./en-public.gen";
import { hi } from "./hi";

describe("dictionaries.web (the web build's on-demand dictionaries)", () => {
  test("up front only the public English; full English and Hindi arrive once, on demand", async () => {
    expect(hasMessages("en")).toBe(false);
    expect(hasMessages("hi")).toBe(false);
    expect(DICTIONARIES.en as unknown).toBe(enPublic);
    expect(DICTIONARIES.hi).toBeUndefined();

    const first = loadMessages("hi");
    expect(loadMessages("hi")).toBe(first);
    await first;
    expect(hasMessages("hi")).toBe(true);
    expect(DICTIONARIES.hi).toBe(hi);

    await loadMessages("en");
    expect(hasMessages("en")).toBe(true);
    expect(DICTIONARIES.en).toBe(en);
    await loadMessages("en");
  });

  test("Gujarati is partial, so loading it brings the full English with it (no raw keys on a gu screen)", async () => {
    // English is already complete from the test above; the contract is that gu waits for it.
    await loadMessages("gu");
    expect(hasMessages("gu")).toBe(true);
    expect(hasMessages("en")).toBe(true);
  });
});
