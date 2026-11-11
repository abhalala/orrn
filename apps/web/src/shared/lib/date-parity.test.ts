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

import * as oldCustomers from "../../../test-support/legacy/customers-dates";
import { formatDay as customersDay, formatInstantDay, formatDispatchDay } from "@/features/customers/dates";
import * as oldMasters from "../../../test-support/legacy/masters-model";
import { formatDay as mastersDay } from "@/features/masters/masters-model";
import * as oldPack from "../../../test-support/legacy/pack-format";
import { packedWhen } from "@/features/pack/format";
import * as oldDispatch from "../../../test-support/legacy/dispatch-format";
import { formatDay as paperDay, formatShipDate, formatYmdDay } from "@/features/dispatch/format";
import { releaseNoteRows } from "@/features/settings/release-notes";
import { dayOrYearText, shipDayText } from "./fmt-text";
import * as oldFoundry from "../../../test-support/legacy/foundry-format";
import { clockText as foundryClock, dayText as foundryDay } from "@/features/foundry/format";
import * as oldDieRoom from "../../../test-support/legacy/die-room-model";
import { shortDate, shortDateTime } from "@/features/die-room/die-room-model";
import { todayYmd as dieRoomToday } from "@/features/die-room/work-model";
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

describe("die room dates", () => {
  test("shortDate and shortDateTime: Kolkata, English month names, in every screen language", () => {
    for (const loc of ["en", "hi"] as const) {
      for (const at of SEEDS) {
        for (const v of [at, new Date(at), new Date(at).toISOString()]) {
          expect(shortDate(dflt(loc), v)).toBe(oldDieRoom.shortDate(v));
          expect(shortDateTime(dflt(loc), v)).toBe(oldDieRoom.shortDateTime(v));
        }
      }
    }
    for (const v of [null, undefined, "not a date", Number.NaN]) {
      expect(shortDate(dflt(), v as never)).toBe(oldDieRoom.shortDate(v as never));
      expect(shortDateTime(dflt(), v as never)).toBe(oldDieRoom.shortDateTime(v as never));
    }
  });
  test("a plant on another zone still reads the die room on Kolkata's clock", () => {
    const at = Date.UTC(2026, 9, 24, 19, 0);
    expect(shortDate(dflt("en", "America/New_York"), at)).toBe("25 Oct 2026");
  });
  test("the work day box value is the calendar day in the zone, not a shown date", () => {
    for (const at of SEEDS) for (const zone of [IST_ZONE, "America/New_York"]) {
      const d = new Date(at);
      expect(dieRoomToday(d, zone)).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d));
    }
  });
});

describe("foundry day and clock", () => {
  test("dayText ('24 Oct', English month names) and clockText ('14:05') on the zone the screen passes", () => {
    for (const loc of ["en", "hi"] as const) {
      for (const zone of [IST_ZONE, "America/New_York"]) {
        for (const at of SEEDS) {
          expect(foundryDay(dflt(loc), at, zone)).toBe(oldFoundry.dayText(at, zone));
          expect(foundryClock(dflt(loc), at, zone)).toBe(oldFoundry.clockText(at, zone));
        }
      }
    }
  });
});

describe("customer dates", () => {
  test("formatDay: '1 Apr', with the year outside the company's year, in English, Hindi and Gujarati", () => {
    for (const loc of ["en", "hi", "gu"] as const) {
      for (const at of SEEDS) for (const today of ["2026-10-03", "2025-01-02"]) {
        expect(customersDay(dflt(loc), ymdOf(at), today)).toBe(oldCustomers.formatDay(ymdOf(at), loc, today));
      }
    }
  });
  test("formatInstantDay and formatDispatchDay read the company's calendar", () => {
    for (const loc of ["en", "hi"] as const) {
      for (const zone of [IST_ZONE, "America/New_York"]) {
        for (const at of SEEDS.slice(0, 500)) {
          expect(formatInstantDay(dflt(loc, zone), at, zone, "2026-10-03")).toBe(oldCustomers.formatInstantDay(at, loc, zone, "2026-10-03"));
          const d = { shipDay: at % 2 === 0 ? { ymd: ymdOf(at) } : null, createdAt: at };
          expect(formatDispatchDay(dflt(loc, zone), d, zone, "2026-10-03")).toBe(oldCustomers.formatDispatchDay(d, loc, zone, "2026-10-03"));
        }
      }
    }
  });
});

describe("masters dates", () => {
  test("formatDay: '4 Oct' or '31 Dec 2025', English month names in every screen language", () => {
    for (const loc of ["en", "hi"] as const) {
      for (const at of SEEDS) for (const today of ["2026-10-04", "2025-01-02"]) {
        expect(mastersDay(dflt(loc), ymdOf(at), today)).toBe(oldMasters.formatDay(ymdOf(at), today));
      }
    }
    expect(mastersDay(dflt(), "not a date", "2026-10-04")).toBe("not a date");
  });
});

describe("pack packedWhen", () => {
  test("day word, date label and time, in English, Hindi and Gujarati, in the zone the screen passes", () => {
    for (const loc of ["en", "hi", "gu"] as const) {
      for (const zone of [IST_ZONE, "America/New_York"]) {
        for (const at of SEEDS.slice(0, 700)) {
          const now = new Date(NOW);
          expect(packedWhen(dflt(loc, zone), at, { now, timeZone: zone })).toEqual(oldPack.packedWhen(at, { now, timeZone: zone, locale: loc }));
          const near = new Date(at + 20 * 3600_000);
          expect(packedWhen(dflt(loc, zone), at, { now: near, timeZone: zone })).toEqual(oldPack.packedWhen(at, { now: near, timeZone: zone, locale: loc }));
        }
      }
    }
  });
});

describe("dispatch days", () => {
  test("the paper's formatDay, formatShipDate and formatYmdDay keep today's text in English, Hindi and Gujarati", () => {
    const now = new Date(NOW);
    for (const locale of ["en", "hi", "gu"]) {
      for (const at of SEEDS.slice(0, 700)) {
        for (const timeZone of [IST_ZONE, "UTC"]) {
          expect(paperDay(at, { now, locale, timeZone })).toBe(oldDispatch.formatDay(at, { now, locale, timeZone }));
        }
        expect(formatShipDate(at, { now, locale })).toBe(oldDispatch.formatShipDate(at, { now, locale }));
        expect(formatYmdDay(ymdOf(at), { now, locale })).toBe(oldDispatch.formatYmdDay(ymdOf(at), { now, locale }));
      }
    }
  });
  test("shipDayText (the dispatch list and header) reads like the old formatYmdDay", () => {
    const now = new Date(NOW);
    for (const loc of ["en", "hi", "gu"] as const) {
      for (const at of SEEDS) expect(shipDayText(dflt(loc), ymdOf(at), now)).toBe(oldDispatch.formatYmdDay(ymdOf(at), { now, locale: loc }));
    }
    expect(shipDayText(dflt(), null)).toBeNull();
    expect(shipDayText(dflt(), "soon")).toBeNull();
  });
  test("release note days: '4 Oct', the year outside the current year, Kolkata", () => {
    const now = new Date(NOW);
    for (const loc of ["en", "hi"] as const) {
      for (const at of SEEDS.slice(0, 300)) {
        const row = { id: "1", platform: "web", version: "1", buildNumber: 1, notes: "x", mandatory: false, publishedAt: new Date(at).toISOString() };
        const [fromRows] = releaseNoteRows([row as never], { fmt: dflt(loc, "America/New_York"), now });
        expect(fromRows?.day).toBe(oldDispatch.formatDay(at, { now, locale: loc }) ?? "");
        expect(dayOrYearText(dflt(loc), at, now.getTime())).toBe(oldDispatch.formatDay(at, { now, locale: loc }) ?? "");
      }
    }
  });
});
