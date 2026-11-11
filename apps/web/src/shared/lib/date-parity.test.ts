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

import { dflt, IST_ZONE } from "../../../test-support/date-seeds";

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
