import { describe, expect, test } from "bun:test";

import { localesToLoad } from "./locale";

const none = () => false;
const all = () => true;

describe("localesToLoad", () => {
  test("/ in English waits for nothing: the entry carries its strings", () => {
    expect(localesToLoad("/", "en", none)).toEqual([]);
  });

  test("/ in Hindi waits for Hindi", () => {
    expect(localesToLoad("/", "hi", none)).toEqual(["hi"]);
  });

  test("every other page waits for its locale's full dictionary", () => {
    expect(localesToLoad("/login", "en", none)).toEqual(["en"]);
    expect(localesToLoad("/today", "hi", none)).toEqual(["hi"]);
  });

  test("nothing to wait for once loaded", () => {
    expect(localesToLoad("/login", "en", all)).toEqual([]);
    expect(localesToLoad("/today", "hi", all)).toEqual([]);
  });
});
