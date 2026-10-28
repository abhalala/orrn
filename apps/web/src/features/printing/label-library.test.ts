import { describe, expect, test } from "bun:test";

import { operationsDense, te200Profile, validateLabelDocument } from "@orrn/domain";

import { LABEL_STARTERS, designNameProblem, designState, filterDesigns, labelSize, uniqueDesignName } from "./label-library";
import { previewIssues, SAMPLE_BUNDLE } from "./label-metrics";

describe("label library starters", () => {
  test("offers the three built-ins, a blank label and at least three more", () => {
    const ids = LABEL_STARTERS.map((starter) => starter.id);
    expect(ids).toEqual(expect.arrayContaining(["operationsDense", "polished", "compact", "blank"]));
    expect(ids.length).toBeGreaterThanOrEqual(7);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const starter of LABEL_STARTERS) {
    test(`${starter.id} is publishable for the TE200 and prints the sample bundle cleanly`, () => {
      expect(validateLabelDocument(starter.document, te200Profile)).toEqual([]);
      expect(previewIssues(starter.document, SAMPLE_BUNDLE)).toEqual([]);
    });
  }

  /** Plants without plant numbering keep `BG-000001-B001` serials (and party numbers): twice as long. */
  const GROUP_SERIAL_BUNDLE = {
    ...SAMPLE_BUNDLE,
    serialNumber: "BG-000008-B014",
    partyNo: "BG-000008-B014",
    qr: "https://plant.orrn.in/b/BG-000008-B014?c=fourcubes",
    weight: "148.432 kg",
    length: "3658 mm",
  };
  for (const starter of LABEL_STARTERS) {
    test(`${starter.id} also prints a group-numbered bundle cleanly`, () => {
      expect(previewIssues(starter.document, GROUP_SERIAL_BUNDLE)).toEqual([]);
    });
  }

  test("sizes read as the stock on the roll", () => {
    expect(labelSize(operationsDense)).toBe("102.25 × 76.2 mm");
    expect(labelSize(LABEL_STARTERS.find((starter) => starter.id === "rackTag")!.document)).toBe("50 × 25 mm");
  });
});

describe("design state", () => {
  const base = { id: "t1", name: "Dense", version: 2, schema: operationsDense, draftSchema: operationsDense, spoolPushedAt: null, updatedAt: "2026-10-01T10:00:00.000Z" };

  test("a design that was never sent says so", () => {
    expect(designState(base)).toMatchObject({ draftChanges: false, send: "never" });
  });

  test("a draft that differs from the published schema is draft changes, and the preview shows the draft", () => {
    const draft = structuredClone(operationsDense);
    draft.elements[0]!.xMm = 6;
    const state = designState({ ...base, draftSchema: draft, spoolPushedAt: "2026-10-01T09:00:00.000Z" });
    expect(state.draftChanges).toBe(true);
    expect(state.send).toBe("sent");
    expect(state.document.elements[0]!.xMm).toBe(6);
  });

  test("published again after the last send means a newer version is waiting", () => {
    expect(designState({ ...base, spoolPushedAt: "2026-10-01T09:00:00.000Z" }).send).toBe("outdated");
    expect(designState({ ...base, spoolPushedAt: "2026-10-01T11:00:00.000Z" }).send).toBe("sent");
  });

  test("a legacy design without a draft previews its published schema", () => {
    expect(designState({ ...base, draftSchema: null }).document.elements).toHaveLength(operationsDense.elements.length);
  });
});

describe("names and search", () => {
  test("filters by name, ignoring case and spaces around the query", () => {
    const designs = [{ name: "Dispatch big weight" }, { name: "Rack tag" }, { name: "Shipping 4x6" }];
    expect(filterDesigns(designs, "  RACK ")).toEqual([{ name: "Rack tag" }]);
    expect(filterDesigns(designs, "")).toHaveLength(3);
  });

  test("a new name must be filled, short enough and not already used", () => {
    expect(designNameProblem("  ", [])).toBe("required");
    expect(designNameProblem("x".repeat(256), [])).toBe("tooLong");
    expect(designNameProblem("rack TAG ", ["Rack tag"])).toBe("taken");
    expect(designNameProblem("Rack tag 2", ["Rack tag"])).toBeNull();
  });

  test("suggests the next free copy name", () => {
    expect(uniqueDesignName("Rack tag copy", ["Rack tag"])).toBe("Rack tag copy");
    expect(uniqueDesignName("Rack tag copy", ["Rack tag", "Rack tag copy", "rack tag copy 2"])).toBe("Rack tag copy 3");
  });
});
