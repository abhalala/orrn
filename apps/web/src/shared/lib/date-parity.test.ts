/**
 * Parity (units layer, slice b part 3): every hand-written date and time helper the screens used before the plant
 * formatter, against its replacement under the default preferences. Same instants in, same text out, character for
 * character, in English and Hindi (and Gujarati where the old helper wrote it). The old helpers live on only as
 * reference copies in `test-support/legacy`. Seeded, so a failure repeats.
 *
 * Under another set the same helpers follow the plant: see `plant-dates.test.tsx`.
 */
import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { windowWords } from "@/features/orders/view";

import * as oldApproval from "../../../test-support/legacy/approval-view";
import { lateWindowText, plantTimeText } from "@/features/approvals/approval-view";
import * as oldPurchase from "../../../test-support/legacy/purchase-format";
import { dflt, IST_ZONE, instants, mulberry, NOW, ymdOf } from "../../../test-support/date-seeds";
import { bookDateText, bookDayText, instantText } from "./fmt-text";

const SEEDS = instants(7, 2000);
const LOCALES = ["en", "hi"] as const;

describe("orders plan window", () => {
  test("the window words take the plant's clock when the screen hands its formatter, and the 24 hour text without one", () => {
    const start = Date.UTC(2026, 9, 25, 2, 30);
    const end = Date.UTC(2026, 9, 26, 2, 30);
    const day = "2026-10-25";
    const plain = windowWords(start, end, IST_ZONE, day);
    expect(plain.from.time).toBe("08:00");
    expect(windowWords(start, end, IST_ZONE, day, dflt())).toEqual(plain);
    const twelve = formatterFor(screenPrefs({ clock: "h12" }), { locale: "en", timeZone: IST_ZONE });
    expect(windowWords(start, end, IST_ZONE, day, twelve).from.time).toBe("8:00 am");
    expect(windowWords(start, end, IST_ZONE, day, twelve).to).toMatchObject({ day: "tomorrow", time: "8:00 am", date: "2026-10-26" });
  });
});

describe("purchase book dates and instants", () => {
  test("bookDateText: '3 Oct 2026' in English and Hindi", () => {
    for (const loc of LOCALES) for (const at of SEEDS) expect(bookDateText(dflt(loc), ymdOf(at))).toBe(oldPurchase.bookDateText(ymdOf(at), loc));
    expect(bookDateText(dflt(), "soon")).toBe("soon");
  });
  test("bookDayText: no year inside the year of today, the year outside it", () => {
    for (const loc of LOCALES) {
      for (const at of SEEDS) {
        for (const today of ["2026-10-04", "2025-01-02", "2024-12-31"]) {
          expect(bookDayText(dflt(loc), ymdOf(at), today)).toBe(oldPurchase.bookDayText(ymdOf(at), loc, today));
        }
      }
    }
    expect(bookDayText(dflt(), "soon", "2026-10-04")).toBe("soon");
  });
  test("instantText: '3 Oct at 14:00', 'at' in English and a comma in Hindi, the year outside the plant's year", () => {
    for (const loc of LOCALES) {
      for (const zone of [IST_ZONE, "America/New_York", "UTC"]) {
        for (const at of SEEDS) {
          expect(instantText(dflt(loc, zone), at, NOW)).toBe(oldPurchase.instantDateText(at, loc, zone, NOW));
        }
      }
    }
  });
});

describe("approvals time text", () => {
  test("plantTimeText and lateWindowText: '24 Oct 21:00', '24 Oct 21:00 to 23:05', English whatever the screen language", () => {
    const r = mulberry(31);
    for (const loc of ["en", "hi"] as const) {
      for (const zone of [IST_ZONE, "America/New_York"]) {
        for (const at of SEEDS) {
          expect(plantTimeText(dflt(loc), at, zone)).toBe(oldApproval.plantTimeText(at, zone));
          const stop = at + Math.floor(r() * 30 * 3600_000);
          expect(lateWindowText(dflt(loc), at, stop, zone)).toBe(oldApproval.lateWindowText(at, stop, zone));
        }
      }
    }
  });
});
