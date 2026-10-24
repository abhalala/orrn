import { describe, expect, test } from "bun:test";

import { DICTIONARIES, hasMessages, loadMessages } from "./dictionaries.web";
import { hi } from "./hi";

describe("dictionaries.web (the web build's on-demand Hindi)", () => {
  test("English is there up front; Hindi arrives once, on demand, and concurrent loads share the fetch", async () => {
    expect(hasMessages("en")).toBe(true);
    expect(hasMessages("hi")).toBe(false);
    const first = loadMessages("hi");
    expect(loadMessages("hi")).toBe(first);
    await first;
    expect(hasMessages("hi")).toBe(true);
    expect(DICTIONARIES.hi).toBe(hi);
    await loadMessages("en");
  });
});
