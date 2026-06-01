/**
 * Cloudflare API client for managing Tunnels and DNS records.
 *
 * Used by the platform admin spool deployment flow to:
 * 1. Create a Cloudflare Tunnel for a spool subdomain
 * 2. Create a CNAME DNS record pointing to the tunnel
 * 3. Delete tunnels and DNS records on revocation
 */

import { env } from "@orrn/env/server";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CfResponse<T = unknown> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

interface TunnelResult {
  id: string;
  name: string;
  status: string;
  token: string;
  created_at: string;
}

interface DnsRecordResult {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function cfFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${CF_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers as Record<string, string> ?? {}) },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as CfResponse<T>;
  if (!json.success) {
    throw new Error(`Cloudflare API error: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  return json.result;
}

/**
 * Create a Cloudflare Tunnel for a spool instance.
 * Returns the tunnel ID and token (the token is used by cloudflared).
 */
export async function createTunnel(name: string): Promise<{ id: string; token: string }> {
  const result = await cfFetch<TunnelResult>(
    `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel`,
    {
      method: "POST",
      body: JSON.stringify({ name, tunnel_type: "cfd_tunnel" }),
    },
  );

  return { id: result.id, token: result.token };
}

/**
 * Delete a Cloudflare Tunnel.
 */
export async function deleteTunnel(tunnelId: string): Promise<void> {
  await cfFetch(`/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, {
    method: "DELETE",
  });
}

/**
 * Create a CNAME DNS record pointing a subdomain to a Cloudflare Tunnel.
 * The record name is the full subdomain (e.g., "acme-corp.spool.orrn.in")
 * and the content is the tunnel's DNS target (e.g., "<tunnel-id>.cfargotunnel.com").
 */
export async function createCnameRecord(
  subdomain: string,
  tunnelId: string,
): Promise<{ recordId: string }> {
  const dnsName = `${subdomain}.spool.orrn.in`;
  const tunnelTarget = `${tunnelId}.cfargotunnel.com`;

  const result = await cfFetch<DnsRecordResult>(
    `/zones/${env.CF_ZONE_ID_IN}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: dnsName,
        content: tunnelTarget,
        proxied: true,
      }),
    },
  );

  return { recordId: result.id };
}

/**
 * Delete a DNS record by its ID.
 */
export async function deleteDnsRecord(recordId: string): Promise<void> {
  await cfFetch(`/zones/${env.CF_ZONE_ID_IN}/dns_records/${recordId}`, {
    method: "DELETE",
  });
}

/**
 * Look up a DNS record by name to find its ID (for cleanup).
 */
export async function findDnsRecord(subdomain: string): Promise<string | null> {
  const dnsName = `${subdomain}.spool.orrn.in`;
  const results = await cfFetch<DnsRecordResult[]>(
    `/zones/${env.CF_ZONE_ID_IN}/dns_records?name=${dnsName}&type=CNAME`,
  );

  return results[0]?.id ?? null;
}