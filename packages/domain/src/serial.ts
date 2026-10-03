/** Trim, uppercase, and strip one layer of surrounding quotes (CSV/Excel paste, wedge scanners). */
export function normalizeSerial(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      s = s.slice(1, -1).trim();
    }
  }
  return s.toUpperCase();
}

export type ScanResult = { kind: "serial"; serial: string } | { kind: "unknown"; raw: string };

const BARE_SERIAL = /^[A-Z0-9][A-Z0-9._-]*$/;
const URL_SERIAL_PATH = /\/b\/([^/]+)\/?$/i;

/** Accepts a bare serial or any URL whose path ends `/b/<serial>` (the QR on the bundle label). */
export function parseScan(raw: string): ScanResult {
  const text = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const match = URL_SERIAL_PATH.exec(new URL(text).pathname);
      if (match?.[1]) {
        const serial = normalizeSerial(decodeURIComponent(match[1]));
        if (BARE_SERIAL.test(serial)) return { kind: "serial", serial };
      }
    } catch {
      // malformed URL or percent-encoding: fall through to unknown
    }
    return { kind: "unknown", raw };
  }
  const serial = normalizeSerial(text);
  return BARE_SERIAL.test(serial) ? { kind: "serial", serial } : { kind: "unknown", raw };
}

/** Newline / comma / space / tab separated serials, normalised and de-duplicated in first-seen order. */
export function splitPastedSerials(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,]+/)) {
    const serial = normalizeSerial(part);
    if (serial) seen.add(serial);
  }
  return [...seen];
}
