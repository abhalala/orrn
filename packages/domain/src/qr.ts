/**
 * Label QR address. Production serves every company from one host (orrn.in),
 * so the URL names the company with `c` (its slug); the public bundle page
 * passes it to `resolve.publicBundle`. Scanners read it back with `parseScan`,
 * which only looks at the path.
 */

/** A company slug as the client accepts it in `?c=`: lowercase letters, digits, hyphens, at most 64. */
const COMPANY_SLUG = /^[a-z0-9-]{1,64}$/;

export function isCompanySlug(value: unknown): value is string {
  return typeof value === "string" && COMPANY_SLUG.test(value);
}

export function bundleQrUrl(input: { origin: string; number: string; companySlug: string }): string {
  const origin = input.origin.replace(/\/+$/, "");
  return `${origin}/b/${encodeURIComponent(input.number)}?c=${encodeURIComponent(input.companySlug)}`;
}
