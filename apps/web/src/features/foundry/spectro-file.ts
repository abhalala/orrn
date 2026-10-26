/**
 * Opening an attached spectro file (FP-FD-11). The bytes sit in the result row; `foundry.spectro.file`
 * returns them as base64 to any member of the plant. The page turns them into a short-lived blob address
 * and opens it in a new tab, so the file never travels in a link anyone could pass on.
 * No imports on purpose: the unit test and the lazy screens share it.
 */

/** The bytes of a base64 string as a Blob of `mime` (a file type the server stores: pdf, photo, text). */
export function base64ToBlob(base64: string, mime: string): Blob {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** A name safe to save under: no path pieces, never empty. */
export function savedName(fileName: string): string {
  const clean = fileName.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return clean === "" ? "spectro" : clean.slice(0, 120);
}
