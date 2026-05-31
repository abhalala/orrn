import type { LengthUnit } from "@orrn/server/lib/length";
import { buildPackingListXlsxBuffer, type PLSnapshot } from "@orrn/documents/packing-list";

export type { PLSnapshot };

export async function downloadPackingListXlsx(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
) {
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

// Re-export PDF helper from local module (uses @react-pdf/renderer).
export { downloadPackingListPdf } from "./packingListPdf";
