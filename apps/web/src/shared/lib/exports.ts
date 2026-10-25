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
  const { buildPackingListXlsxBuffer, plFileName } = await import("@orrn/documents/packing-list");
  const buffer = buildPackingListXlsxBuffer(pl, code, undefined, opts);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plFileName(code)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Print the packing list from the browser: the same HTML the native print uses, in a hidden frame so
 * no popup is needed. The HTML builder loads on click like the other exports.
 */
export async function printPackingList(pl: PackingListSnapshot, code: string, opts: ExportOptions = {}) {
  const { buildPackingListHtml } = await import("@orrn/documents/packing-list");
  const html = buildPackingListHtml(pl, code, undefined, opts);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const done = new Promise<void>((resolve) => {
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        // The print dialog is modal in most browsers; remove the frame once it is gone.
        setTimeout(() => {
          frame.remove();
          resolve();
        }, 1000);
      }
    };
  });
  frame.srcdoc = html;
  await done;
}
