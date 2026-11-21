import { describe, expect, test } from "bun:test";

import { uploadStrip } from "./list-model";
import { ReadError } from "./reader-client";
import { memoHash, uploadFailureProblem } from "./upload-problem";
import { PartPutError } from "./upload-parts";
import type { UploadItem } from "./upload";

/** Upload failure words (web review S2, decision 12): keep the real error, a dropped part can be resumed, never "save as Excel" for a PDF or a photo. */

const item = (over: Partial<UploadItem>): UploadItem => ({
  id: "u1", name: "scan.pdf", size: 300_000_000, kind: "pdf_scan", step: "failed", progress: null, sent: null, artifactId: "A1",
  seenOn: null, notStored: false, problem: null, ...over,
});

describe("the words of a failed upload", () => {
  test("Wi-Fi drops while the parts go: the upload stopped and Try again carries on", () => {
    expect(uploadFailureProblem(new TypeError("Failed to fetch"), { kind: "pdf_scan", step: "saving" })).toEqual({ key: "ingest.upload.error.stopped" });
    expect(uploadFailureProblem(new PartPutError(503), { kind: "csv", step: "saving" })).toEqual({ key: "ingest.upload.error.stopped" });
  });

  test("a server refusal while saving keeps its own words", () => {
    const refusal = { message: "The upload ran out of time", data: { code: "BAD_REQUEST" } };
    expect(uploadFailureProblem(refusal, { kind: "pdf_scan", step: "saving" })).toEqual({ key: "ingest.upload.error.ranOut" });
  });

  test("a network failure while the pages are read says the network, not save as Excel", () => {
    expect(uploadFailureProblem(new TypeError("Failed to fetch"), { kind: "pdf_scan", step: "pages" })).toEqual({ key: "ingest.error.network" });
    const vision = { message: "Upload this page first", data: { code: "PRECONDITION_FAILED" } };
    expect(uploadFailureProblem(vision, { kind: "image", step: "pages" })).toEqual({ key: "ingest.vision.error.uploadFirst" });
  });

  test("a sheet orrn could not read keeps the read words; a PDF or photo never hears save as Excel", () => {
    const broken = new ReadError({ code: "unreadable", detail: "worker failed" });
    expect(uploadFailureProblem(broken, { kind: "sheet", step: "reading" })).toEqual({ key: "ingest.read.failed" });
    expect(uploadFailureProblem(broken, { kind: "pdf_text", step: "hashing" })).toEqual({ key: "ingest.read.failedPage" });
    expect(uploadFailureProblem(broken, { kind: "image", step: "hashing" })).toEqual({ key: "ingest.read.failedPage" });
  });

  test("the strip shows the problem kept on the item, whatever its key", () => {
    expect(uploadStrip([item({ problem: { key: "ingest.error.network" } })], [])[0]).toMatchObject({ words: { key: "ingest.error.network" } });
    expect(uploadStrip([item({ problem: { key: "ingest.upload.error.stopped" } })], [])[0]).toMatchObject({ actions: ["retry"], words: { key: "ingest.upload.error.stopped" } });
    expect(uploadStrip([item({ problem: { key: "ingest.vision.error.uploadFirst" } as never })], [])[0]).toMatchObject({ words: { key: "ingest.vision.error.uploadFirst" } });
  });

  test("a failed PDF or photo with no problem kept never says save as Excel; a sheet still does", () => {
    expect(uploadStrip([item({ problem: null })], [])[0]).toMatchObject({ words: { key: "ingest.read.failedPage" } });
    expect(uploadStrip([item({ problem: { key: "ingest.read.failed" } })], [])[0]).toMatchObject({ words: { key: "ingest.read.failedPage" } });
    expect(uploadStrip([item({ kind: "sheet", name: "a.xlsx", problem: null })], [])[0]).toMatchObject({ words: { key: "ingest.read.failed" } });
  });
});

describe("Try again does not hash a large file again (S2)", () => {
  test("the digest of a file is kept, and dropped when hashing failed", async () => {
    let calls = 0;
    const hash = memoHash(async () => {
      calls += 1;
      if (calls === 1) throw new Error("worker stopped");
      return { sha256: "a".repeat(64), parts: ["p1"] };
    });
    const file = new File(["x"], "scan.pdf");
    await expect(hash(file)).rejects.toThrow("worker stopped");
    expect(await hash(file)).toEqual({ sha256: "a".repeat(64), parts: ["p1"] });
    expect(await hash(file)).toEqual({ sha256: "a".repeat(64), parts: ["p1"] });
    expect(calls).toBe(2);
  });
});
