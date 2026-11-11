/**
 * Guard (units layer, slice b part 3): a web source file formats a date or a time through the plant's `Fmt`, never with the
 * browser's own formatter. `toLocaleDateString`, `toLocaleTimeString`, `Intl.DateTimeFormat` and the helpers this layer
 * replaced (`dayMonth`, `ymdLabel`, `intlTag`, `instantDateText`, `formatWhen`) fail the build in any file under
 * `apps/web/src` that is not on the short allow-list in `test-support/date-guard-scan.ts`, each entry with its reason.
 *
 * Why it matters: a plant that chose day-month-year or a 12 hour clock must see that on every screen, and one forgotten
 * `toLocaleDateString` is a screen that does not follow. Zone maths that is logic (the production day, a filter's day)
 * lives in `plant-calendar.ts`, the one module allowed to use `Intl.DateTimeFormat` for that.
 */
import { describe, expect, test } from "bun:test";

import { ALLOWED, allowedBy, findings, FIXED_LOCALE_FINDING, FIXED_LOCALE_NUMBER_OK, PAPER_HELPER_HOMES, stripComments, webSourceFiles } from "../../../test-support/date-guard-scan";

describe("dates and times go through the plant formatter", () => {
  const files = webSourceFiles();

  test("the scan reaches the whole web source (it cannot pass by finding nothing)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.rel === "shared/lib/fmt-text.ts")).toBe(true);
    expect(files.some((f) => f.rel === "features/orders/orders-page.tsx")).toBe(true);
  });

  test("no web source file outside the allow-list formats a date or time itself", () => {
    const bad = files
      .filter((f) => !allowedBy(f.rel))
      .flatMap((f) => findings(f.text).map((what) => `${f.rel}: ${what}`))
      // The paper's own helpers are fine in the files that define and use them.
      .filter((line) => !(line.endsWith("paper date helper") && PAPER_HELPER_HOMES.test(line.split(":")[0]!)))
      // A few staff, file and money files may group a number with a fixed locale (see FIXED_LOCALE_NUMBER_OK).
      .filter((line) => !(line.endsWith(FIXED_LOCALE_FINDING) && FIXED_LOCALE_NUMBER_OK.some((a) => a.path.test(line.split(":")[0]!))));
    expect(bad).toEqual([]);
  });

  test("every fixed-locale number exception has a reason and still needs the exception", () => {
    for (const a of FIXED_LOCALE_NUMBER_OK) {
      expect(a.why.length).toBeGreaterThan(20);
      const needs = files.some((f) => a.path.test(f.rel) && findings(f.text).includes(FIXED_LOCALE_FINDING));
      expect(needs).toBe(true);
    }
  });

  test("every allow-list entry has a reason and still needs the exception", () => {
    for (const a of ALLOWED) {
      expect(a.why.length).toBeGreaterThan(20);
      const hits = files.filter((f) => a.path.test(f.rel));
      // The entry has to match a real file; the packing list and ingest entries may match files that no longer need it,
      // but a calendar, staff or zone-picker entry that matches nothing is a stale exception.
      if (!a.optional) expect(hits.length).toBeGreaterThan(0);
    }
    for (const label of ["shared/lib/plant-calendar.ts", "features/admin/", "features/auth/timezones.ts"]) {
      const entry = ALLOWED.find((a) => a.label === label)!;
      const needs = files.some((f) => entry.path.test(f.rel) && findings(f.text).length > 0);
      expect(needs).toBe(true);
    }
  });

  test("the scan itself sees each forbidden form, and not a comment that names one", () => {
    expect(findings('const a = d.toLocaleDateString("en-IN");')).toEqual(["toLocaleDateString"]);
    expect(findings("const a = d.toLocaleTimeString();")).toEqual(["toLocaleTimeString"]);
    expect(findings('new Intl.DateTimeFormat("en", {})')).toEqual(["Intl.DateTimeFormat"]);
    expect(findings("const w = dayMonth(date, locale, tz);")).toEqual(["old date helper"]);
    expect(findings("const w = instantDateText(at, locale);")).toEqual(["old date helper"]);
    expect(findings("const w = formatShipDate(d, { locale });")).toEqual(["paper date helper"]);
    expect(findings("// uses Intl.DateTimeFormat to read the zone\nconst a = 1;")).toEqual([]);
    expect(findings("/* toLocaleDateString */ const a = 1;")).toEqual([]);
    expect(findings('const a = n.toLocaleString("en-IN");')).toEqual([FIXED_LOCALE_FINDING]);
    expect(findings("const a = n.toLocaleString('en-US', { maximumFractionDigits: 3 });")).toEqual([FIXED_LOCALE_FINDING]);
    expect(findings("const a = (x / 100).toLocaleString(`en-IN`);")).toEqual([FIXED_LOCALE_FINDING]);
    expect(findings("// n.toLocaleString(\"en-IN\") was here\nconst a = countText(fmt, n);")).toEqual([]);
    expect(findings("const a = fmt.date(ms) + fmt.time(ms);")).toEqual([]);
    expect(stripComments("const u = 'http://x'; // note")).toContain("http://x");
  });
});
