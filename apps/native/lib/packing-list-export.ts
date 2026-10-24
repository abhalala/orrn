import {
  buildPackingListHtml,
  buildPackingListXlsxBase64,
  plFileName,
  type PLSnapshot,
} from "@orrn/documents/packing-list";
import type { LengthUnit } from "@orrn/server/lib/length";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

async function shareFile(uri: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device");
  }
  await Sharing.shareAsync(uri, { mimeType, UTI: mimeType });
}

export async function sharePackingListPdf(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
) {
  const html = buildPackingListHtml(pl, code, lengthUnit);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await shareFile(uri, "application/pdf");
}

export async function sharePackingListXlsx(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
) {
  const base64 = buildPackingListXlsxBase64(pl, code, lengthUnit);
  // PL numbers carry slashes (PL/2026-27/14); a raw one would point into missing folders.
  const uri = `${FileSystem.cacheDirectory}${plFileName(code)}.xlsx`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await shareFile(
    uri,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
