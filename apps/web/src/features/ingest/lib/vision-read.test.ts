import { describe, expect, test } from "bun:test";

import { cannotReadNow, readVisualBytes } from "./vision-read";
import type { VisionApi } from "./vision-api";
import { RenderError, type PageSource } from "./vision-render";

const refusal = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

function api(start: VisionApi["start"]): VisionApi {
  const no = async () => {
    throw new Error("not used");
  };
  return { start, readPage: no, pages: no, skipPage: no, typePage: no, readUrl: no, check: no, fixCell: no, complete: no } as VisionApi;
}

const source = (closed: string[]): PageSource => ({ pageCount: 1, render: async () => new Blob(["x"]), close: () => closed.push("closed") });

describe("reading a PDF or photo from the bytes in hand", () => {
  test("a file the browser cannot open stays kept, and the server is never asked", async () => {
    let started = 0;
    const out = await readVisualBytes({
      api: api(async () => (started++, { pageCount: 1, planned: 1, uploads: [] })),
      artifactId: "a",
      file: new Blob(["x"]),
      kind: "image",
      open: async () => {
        throw new RenderError("cannot_open");
      },
    });
    expect(out).toEqual({ kind: "cannotOpen" });
    expect(started).toBe(0);
  });

  test("no storage or no model on the plant: the file stays kept with today's words, and the pages are closed", async () => {
    const closed: string[] = [];
    for (const message of [
      "PDFs and photos need file storage, which is not set up for this plant. Ask orrn support to turn it on.",
      "PDFs and photos are kept, not read, in this release. They will be read in a later release.",
    ]) {
      const out = await readVisualBytes({
        api: api(async () => {
          throw refusal("PRECONDITION_FAILED", message);
        }),
        artifactId: "a",
        file: new Blob(["x"]),
        kind: "pdf_text",
        open: async () => source(closed),
      });
      expect(out).toEqual({ kind: "cannotReadNow" });
    }
    expect(closed).toEqual(["closed", "closed"]);
  });

  test("other refusals are not taken for 'cannot read now'", () => {
    expect(cannotReadNow(refusal("PRECONDITION_FAILED", "The original file is not saved yet. Upload the same file again, then approve."))).toBe(false);
    expect(cannotReadNow(refusal("BAD_REQUEST", "PDFs and photos need file storage, which is not set up for this plant."))).toBe(false);
  });
});
