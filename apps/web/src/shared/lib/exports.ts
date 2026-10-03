/**
 * The only door to heavy export code. `@react-pdf/renderer` (~1.4 MB) and the
 * xlsx writer load via `await import()` when a user clicks Download, never as
 * part of an initial or route chunk (W3). Import these functions, not
 * `packingListPdf` or `@orrn/documents/packing-list` directly. Pass the
 * snapshot already parsed by `parsePackingListSnapshot` (W17).
 */
import type { PackingListSnapshot } from "@orrn/documents/packing-list/model";

export type { PackingListSnapshot };

export type ExportOptions = { timeZone?: string };

export async function downloadPackingListPdf(pl: PackingListSnapshot, code: string, opts: ExportOptions = {}) {
  const { downloadPackingListPdf: run } = await import("./packingListPdf");
  await run(pl, code, opts);
}

export async function downloadPackingListXlsx(pl: PackingListSnapshot, code: string, opts: ExportOptions = {}) {
  const { buildPackingListXlsxBuffer } = await import("@orrn/documents/packing-list");
  const buffer = buildPackingListXlsxBuffer(pl, code, undefined, opts);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${code}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
