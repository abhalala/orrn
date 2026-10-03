/**
 * The only door to heavy export code. `@react-pdf/renderer` (~1.4 MB) and the
 * xlsx writer load via `await import()` when a user clicks Download, never as
 * part of an initial or route chunk (W3). Import these functions, not
 * `packingListPdf` or `@orrn/documents/packing-list` directly.
 */
import type { PLSnapshot } from "@orrn/documents/packing-list";
import type { LengthUnit } from "@orrn/server/lib/length";

export type { PLSnapshot };

export async function downloadPackingListPdf(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
  opts: { includeQr?: boolean } = {},
) {
  const { downloadPackingListPdf: run } = await import("./packingListPdf");
  await run(pl, code, lengthUnit, opts);
}

export async function downloadPackingListXlsx(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
) {
  const { buildPackingListXlsxBuffer } = await import("@orrn/documents/packing-list");
  const buffer = buildPackingListXlsxBuffer(pl, code, lengthUnit);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${code}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
