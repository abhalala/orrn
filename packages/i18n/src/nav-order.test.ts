import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { hi } from "./hi";

describe("nav arrange review words", () => {
  test("shared actions and reset wording use the requested keys", () => {
    expect(en.nav).not.toHaveProperty("done");
    expect(en.nav).not.toHaveProperty("cancel");
    expect(hi.nav).not.toHaveProperty("done");
    expect(hi.nav).not.toHaveProperty("cancel");
    expect(en.nav.keepOrder).toBe("Keep my order");
    expect(hi.nav.keepOrder).toBe("मेरा क्रम रखें");
    expect(en.nav.dragToMove).toBe("Reorder {name}");
    expect(hi.nav.dragToMove).toBe("{name} का क्रम बदलें");
    expect(hi.nav.moved).toBe("{name} अब {total} में से {position} नंबर पर है");
  });

  test("the hint and divider announcements name the destination", () => {
    expect(en.nav.arrangeHint).toBe("Items above More stay at the top of the menu. Drag an item across the line to move it.");
    expect(hi.nav.arrangeHint).toBe("आइटम खींचें या तीर दबाएं। आइटम और वाली रेखा के ऊपर या नीचे जा सकते हैं।");
    expect(en.nav.movedAbove).toBe("{name} moved above More");
    expect(en.nav.movedBelow).toBe("{name} moved below More");
    expect(hi.nav.movedAbove).toBe("{name} और के ऊपर ले जाया गया");
    expect(hi.nav.movedBelow).toBe("{name} और के नीचे ले जाया गया");
  });
});
