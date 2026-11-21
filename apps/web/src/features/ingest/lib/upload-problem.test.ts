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

describe("limit refusals name the limit and who can raise it (decision 3)", () => {
  const refusal = (message: string) => ({ message, data: { code: "BAD_REQUEST" } });

  test("at begin: too big for the plant, too big for orrn, storage full, and the old per-kind refusal without a vault", async () => {
    const { problemFromError } = await import("./upload");
    expect(problemFromError(refusal("scan.pdf is too big. The largest file for this plant is 100 MB. orrn support can raise it."), "scan.pdf")).toEqual({
      key: "ingest.upload.refused.fileTooBig", vars: { name: "scan.pdf", size: "100 MB" },
    });
    expect(problemFromError(refusal("scan.pdf is too big. The largest file orrn can take is 2048 MB."), "scan.pdf")).toEqual({
      key: "ingest.upload.refused.fileTooBigMax", vars: { name: "scan.pdf", size: "2048 MB" },
    });
    expect(problemFromError(refusal("This plant's file storage is full (50 GB). orrn support can raise it."), "scan.pdf")).toEqual({
      key: "ingest.upload.refused.storageFull", vars: { size: "50 GB" },
    });
    expect(problemFromError(refusal("big.xlsx is too big. The limit for this kind of file is 20 MB."), "big.xlsx")).toEqual({
      key: "ingest.upload.refused.tooBigKind", vars: { name: "big.xlsx", limit: "20" },
    });
  });

  test("storage full when the parts start (uploadStart) keeps the same words, not a generic refusal", () => {
    expect(uploadFailureProblem(refusal("This plant's file storage is full (50 GB). orrn support can raise it."), { kind: "pdf_scan", step: "saving" })).toEqual({
      key: "ingest.upload.refused.storageFull", vars: { size: "50 GB" },
    });
  });

  test("the strip says them with their values", () => {
    const shown = uploadStrip([item({ problem: { key: "ingest.upload.refused.storageFull", vars: { size: "50 GB" } } })], [])[0];
    expect(shown).toMatchObject({ words: { key: "ingest.upload.refused.storageFull", vars: { size: "50 GB" } } });
  });
});
