import { describe, expect, test } from "bun:test";

import { chunkName } from "./chunk-name";

describe("chunkName", () => {
  test("drops the folder, the hash and the extension", () => {
    expect(chunkName("/assets/tanstack-Bp1GKBl5.js")).toBe("tanstack");
    expect(chunkName("/assets/react-pdf.browser-T6d2ixNK.js")).toBe("react-pdf.browser");
    expect(chunkName("/assets/packing-list-view-AbCd1234.js")).toBe("packing-list-view");
    expect(chunkName("/assets/xlsx-x_9p_yAS.js")).toBe("xlsx");
  });

  test("a hash that happens to spell pdf is not part of the name", () => {
    // The real case: the public dictionary chunk of one build.
    expect(chunkName("/assets/src-CidDPDF4.js")).toBe("src");
    expect(/pdf|xlsx|packing-list/i.test(chunkName("/assets/src-CidDPDF4.js"))).toBe(false);
    expect(/pdf|xlsx|packing-list/i.test(chunkName("/assets/react-pdf.browser-T6d2ixNK.js"))).toBe(true);
  });
});
