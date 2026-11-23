/**
 * XE PLATFORM row 83: SSRF guard for webhook URLs. The static URL rule is `webhookUrlProblem` (`@orrn/domain`); this
 * adds resolve-and-check: every A and AAAA record of the host must be a public address. A Worker cannot pin the
 * connection to the address it checked (fetch resolves again), so a host that changes its records between the check
 * and the send is not stopped here; redirects are never followed, and the check runs again at every delivery.
 */
import { isBlockedAddress, webhookUrlProblem, type WebhookUrlProblem } from "@orrn/domain";

export type Resolver = (host: string) => Promise<string[]>;

/** DNS over HTTPS (Cloudflare), A and AAAA. Throws when the name does not resolve. */
export function dohResolver(fetchImpl: typeof fetch = fetch): Resolver {
  return async (host) => {
    const out: string[] = [];
    for (const type of ["A", "AAAA"] as const) {
      const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        redirect: "manual",
      });
      if (!res.ok) throw new Error("dns_failed");
      const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of json.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(a.data);
    }
    return out;
  };
}

export type UrlCheck = { ok: true } | { ok: false; problem: WebhookUrlProblem | "unresolved" };

export async function checkWebhookUrl(raw: string, resolve: Resolver): Promise<UrlCheck> {
  const problem = webhookUrlProblem(raw);
  if (problem) return { ok: false, problem };
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return { ok: true }; // a public IP literal, already checked
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, problem: "unresolved" };
  }
  if (addresses.length === 0) return { ok: false, problem: "unresolved" };
  if (addresses.some(isBlockedAddress)) return { ok: false, problem: "private_host" };
  return { ok: true };
}
