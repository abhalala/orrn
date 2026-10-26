import { describe, expect, test } from "bun:test";

import { listedReason, mimeForUpload, planBulk, summariseBulk, type NameMatch } from "./bulk-attach";

const m = (over: Partial<NameMatch> & Pick<NameMatch, "name" | "status">): NameMatch => ({
  kind: "pdf",
  sectionId: null,
  dieInstanceId: null,
  target: null,
  pressDrawing: false,
  alreadyThere: false,
  ...over,
});

describe("planBulk", () => {
  const matches: NameMatch[] = [
    m({ name: "12170.pdf", status: "section", sectionId: "s1", target: "Domal 12170", pressDrawing: true }),
    m({ name: "12170-1.cdr", status: "copy", kind: "cdr", sectionId: "s1", dieInstanceId: "c1", target: "12170-1" }),
    m({ name: "99999.pdf", status: "unmatched" }),
    m({ name: "12170-2.dwg", status: "copy", kind: "dwg", sectionId: "s1", dieInstanceId: "c2", alreadyThere: true }),
    m({ name: "notes.txt", status: "unsupported", kind: null }),
    m({ name: "13090.pdf", status: "ambiguous" }),
  ];

  test("matched files go up in the order picked; already-there ones and unmatched names are set aside", () => {
    const plan = planBulk(matches);
    expect(plan.upload.map((e) => e.match.name)).toEqual(["12170.pdf", "12170-1.cdr"]);
    expect(plan.upload.map((e) => e.index)).toEqual([0, 1]);
    expect(plan.already.map((e) => e.match.name)).toEqual(["12170-2.dwg"]);
    expect(plan.listed.map((e) => e.match.name)).toEqual(["99999.pdf", "notes.txt", "13090.pdf"]);
  });

  test("the reason line names why a file was not attached", () => {
    expect(listedReason("unmatched")).toBe("unmatched");
    expect(listedReason("unsupported")).toBe("unsupported");
    expect(listedReason("ambiguous")).toBe("ambiguous");
  });

  test("the summary counts saved, failed, already there, not matched and drawings", () => {
    const plan = planBulk(matches);
    const sum = summariseBulk(plan, [
      { index: 0, ok: true, pressDrawing: true },
      { index: 1, ok: false, error: "This CDR is larger than 40 MB" },
    ]);
    expect(sum).toEqual({ saved: 1, drawings: 1, failed: 1, already: 1, notMatched: 3 });
  });
});

describe("mimeForUpload", () => {
  test("PDF is application/pdf, CDR and DWG send no type, images keep theirs or follow the extension", () => {
    expect(mimeForUpload("pdf", { name: "a.pdf", type: "" })).toBe("application/pdf");
    expect(mimeForUpload("cdr", { name: "a.cdr", type: "application/vnd.corel-draw" })).toBe("");
    expect(mimeForUpload("dwg", { name: "a.dwg", type: "image/vnd.dwg" })).toBe("");
    expect(mimeForUpload("image", { name: "a.png", type: "image/png" })).toBe("image/png");
    expect(mimeForUpload("image", { name: "a.webp", type: "" })).toBe("image/webp");
    expect(mimeForUpload("image", { name: "a.JPG", type: "" })).toBe("image/jpeg");
  });
});
