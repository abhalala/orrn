/**
 * Round 6 minors (PORTAL-S-CHECK-5): M-1, a PO-only row is never matched to a live order of another
 * financial year (rule 4.2); M-2, the server checks the file's name and type against the kind sent.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, mergeOnce, plant, pump, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const FIELDS = [
  { field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] },
  { field: "oldOrderNo", steps: trim },
  { field: "poNumber", steps: trim },
  { field: "orderDate", steps: [{ op: "date" as const, format: "dmy" as const }] },
  { field: "series", steps: [{ op: "trim" as const }, { op: "case" as const, to: "upper" as const }] },
  { field: "sectionCode", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "section_by_code" as const }] },
  { field: "cutLength", steps: [{ op: "number" as const, kind: "length" as const, unit: "mm" }] },
  { field: "bakiKg", steps: [{ op: "number" as const, kind: "mass" as const, unit: "kg" }] },
];
const R = (no: string, po: string, date: string, sec: string) => ["Acme Traders", no, po, date, "R", sec, "3658", "100"];
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");
const seqOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).serverSeq;

describe("M-1: a PO-only row and a live order of another financial year", () => {
  test("the row is not a line of the 2024-25 order: one PO on another year's order, a conflict the person skips", async () => {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    for (const code of ["5100", "5101"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
    const a = await upload(p.owner, [{ name: "A", headers: BOOK, rows: [R("41", "PO-9", "31/10/2024", "5100")] }], "a.xlsx");
    await pump(p.owner, a.candidates[0]!.id);
    await p.owner.ingest.candidate.approve({ candidateId: a.candidates[0]!.id, expectSeq: await seqOf(p.owner, a.candidates[0]!.id) });
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const b = await upload(p.owner, [{ name: "B", headers: BOOK, rows: [R("", "PO-9", "01/11/2025", "5101")] }], "b.xlsx");
    const id = b.candidates[0]!.id;
    await pump(p.owner, id);
    const [row] = await rowsOf(p.owner, id);
    expect(row!.state).toBe("conflict");
    expect(row!.reasons).toContain("po_on_live_order:poNumber");
    expect(row!.reasons).not.toContain("order_line_new");
  });
});

describe("M-2: the server checks the file kind against its name and type", () => {
  test("a PDF begun as a sheet is refused; the same PDF as a PDF is kept", async () => {
    const p = await plant(env);
    const begin = (kind: "sheet" | "pdf_text" | "image" | "csv", fileName: string, contentType: string | null) =>
      p.owner.ingest.artifact.begin({ sha256: sha(), fileName, sizeBytes: 2048, contentType, kind });
    await expect(begin("sheet", "packing.pdf", "application/pdf")).rejects.toThrow("This file does not match the kind sent. Choose the file again.");
    await expect(begin("sheet", "packing.xlsx", "application/pdf")).rejects.toThrow("This file does not match the kind sent. Choose the file again.");
    await expect(begin("csv", "photo.jpg", "image/jpeg")).rejects.toThrow("This file does not match the kind sent. Choose the file again.");
    await expect(begin("image", "book.xlsx", null)).rejects.toThrow("This file does not match the kind sent. Choose the file again.");
    expect((await begin("sheet", "book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).artifactId).toBeTruthy();
    expect((await begin("csv", "book.csv", "text/csv")).artifactId).toBeTruthy();
    expect((await begin("sheet", "no-extension", null)).artifactId).toBeTruthy();
  });
});
