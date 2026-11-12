/**
 * A built chunk's own name: no folder, no content hash, no extension. The hash is random letters and
 * digits (a build once produced `src-CidDPDF4.js`, the public dictionary), so a rule about chunk names
 * must never read it.
 */
export function chunkName(href: string): string {
  const file = href.split("/").pop() ?? href;
  return file.replace(/\.[a-z]+$/i, "").replace(/-[A-Za-z0-9_]{8}$/, "");
}
