import {
  buildPackingListHtml,
  buildPackingListXlsxBase64,
  type PLSnapshot,
} from "@orrn/documents/packing-list";
import type { LengthUnit } from "@orrn/server/lib/length";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { PL_SHARE_TARGETS, plFileName, type PlShareKind } from "./packing-list-share";

async function shareFile(uri: string, kind: PlShareKind) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device");
  }
  const { mimeType, UTI } = PL_SHARE_TARGETS[kind];
  await Sharing.shareAsync(uri, { mimeType, UTI });
}

/** Renders the packing list to a PDF in the cache and opens the share sheet. */
export async function sharePackingListPdf(pl: PLSnapshot, code: string, lengthUnit: LengthUnit = "mm") {
  const html = buildPackingListHtml(pl, code, lengthUnit);
  const printed = await Print.printToFileAsync({ html, base64: false });
  // printToFileAsync names the file itself (a UUID): move it so the recipient sees packing-list-D-0007.pdf.
  const uri = `${FileSystem.cacheDirectory}${plFileName(code, "pdf")}`;
  await FileSystem.deleteAsync(uri, { idempotent: true });
  await FileSystem.moveAsync({ from: printed.uri, to: uri });
  await shareFile(uri, "pdf");
}

/** Writes the packing list as an Excel file in the cache and opens the share sheet. */
export async function sharePackingListXlsx(pl: PLSnapshot, code: string, lengthUnit: LengthUnit = "mm") {
  const base64 = buildPackingListXlsxBase64(pl, code, lengthUnit);
  const uri = `${FileSystem.cacheDirectory}${plFileName(code, "xlsx")}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await shareFile(uri, "xlsx");
}
