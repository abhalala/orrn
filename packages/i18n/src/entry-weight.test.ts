import { expect, test } from "bun:test";

import * as i18n from "./index";

// The index ships in the web entry chunk (700 kB cap). Guide books are big
// and only needed by the Guides screen and HowTo sheets, which import them
// from "@orrn/i18n/guides".
test("the package index does not carry guide content", () => {
  expect("getGuide" in i18n).toBe(false);
  expect("listGuides" in i18n).toBe(false);
  expect(i18n.GUIDE_SLUGS.length).toBeGreaterThan(0);
});
