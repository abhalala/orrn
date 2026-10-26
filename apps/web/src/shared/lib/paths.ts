/**
 * Bundle page: the path a label QR opens. The serial is the bundle's number
 * (`26I4086`, or `BG-000001-B001` for companies on the old numbering).
 */
export function bundleDetailPath(bundle: { serial: string }): string {
  return `/b/${encodeURIComponent(bundle.serial)}`;
}
