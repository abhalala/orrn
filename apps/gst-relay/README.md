# @orrn/gst-relay

A small Bun + Hono service that forwards signed requests from the orrn Worker to the GST e-invoice
IRP (IRIS integrator route, `einvoice6.gst.gov.in`) or NIC.

**Status: built, not live.** It is not deployed by CI. No real credentials exist yet. The upstream client
(`src/upstream.ts`, `nicStyleUpstream`) is written to the published GSTN API spec and has **not** been run
against the IRIS sandbox. Tests use fakes only.

## Why it exists

NIC and the IRPs refuse non-Indian IPs, and production needs whitelisted Indian static IPs. A Cloudflare
Worker has neither. So the Worker never calls a government endpoint: it calls this relay, which runs on an
Indian static-IP VPS and holds the GST credentials.

## Endpoints

All POST, JSON, signed (see `packages/domain/src/gstRelayAuth.ts`), except `GET /health`.

| Path | Body |
| --- | --- |
| `/v1/irn/generate` | `{gstin, payload}` |
| `/v1/irn/cancel` | `{gstin, irn, reasonCode, remark}` |
| `/v1/irn/by-document` | `{gstin, docType, docNo, docDate}` |
| `/v1/ewb/generate-by-irn` | `{gstin, payload}` |
| `/v1/ewb/cancel` | `{gstin, ewbNo, reasonCode, remark}` (answers `not_configured` until an EWB ASP account exists) |

Business errors come back as HTTP 200 with `{ok:false, code, message, retryable}`. Relay problems use
4xx: 400 bad request, 401 unauthorised (also replay or an unknown tenant), 403 GSTIN not bound to the calling
plant, 413 body over 1 MB.

## Who may call for which GSTIN

Authority is the orrn plant (tenant), never the GSTIN in the body: a plant admin can edit the letterhead
GSTIN. Every request carries `x-orrn-tenant` (the company id) and is signed with THAT tenant's key
(`relayTenantKey(GST_RELAY_SECRET, companyId)` in `@orrn/domain`, derived on the Worker). The relay holds
only the per-tenant keys, each bound to the GSTINs that plant may act for, and refuses a GSTIN bound to
another tenant (403 `relay_gstin_not_bound`). A GSTIN may be bound to one tenant only; the relay refuses to
start otherwise. Make a tenant's key with `GST_RELAY_SECRET=... bun run tenant-key <companyId>`.

## Run

```sh
bun install
IRP_PUBLIC_KEY_PEM="$(cat irp.pem)" GST_CREDENTIALS_FILE=/etc/gst-relay/creds.json bun run start
```

| Env | Meaning |
| --- | --- |
| `RELAY_PORT` | Default 8787. |
| `RELAY_HOST` | Default 127.0.0.1. Put a TLS reverse proxy in front. |
| `IRP_BASE_URL` | IRP base URL. Default is a placeholder sandbox URL; confirm at integrator registration. |
| `IRP_PUBLIC_KEY_PEM` | The IRP's RSA public key (PEM). |
| `GST_CREDENTIALS_FILE` | Path to the credentials JSON. Keep mode 600; the relay warns otherwise. |

Credentials file:

```json
{
  "tenants": {
    "<orrn company id>": {
      "key": "<64 hex from bun run tenant-key>",
      "gstins": { "24ABCDE1234F1Z5": { "username": "...", "password": "...", "clientId": "...", "clientSecret": "..." } }
    }
  }
}
```

The relay logs only method, path, status, duration, tenant and GSTIN. Never secrets, tokens, SEKs or invoices.

### systemd

```ini
[Unit]
Description=orrn GST relay
After=network-online.target

[Service]
User=gstrelay
EnvironmentFile=/etc/gst-relay/env
WorkingDirectory=/opt/orrn/apps/gst-relay
ExecStart=/usr/local/bin/bun run src/index.ts
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Reverse proxy and firewall

Terminate TLS in Caddy or nginx and proxy to 127.0.0.1:8787. Cloudflare Worker egress IPs are not fixed,
so an IP allow-list is not possible. The gate is the HMAC signature plus the 5 minute replay window and the
nonce store (in memory: a restart forgets nonces, but stale timestamps are still refused). Open only 443
inbound; outbound only to the IRP host. Tenant keys are derived from the Worker's `GST_RELAY_SECRET`: if it or any tenant key leaks, rotate the
secret and re-issue every tenant key. A leaked tenant key can sign only for that tenant's bound GSTINs.

## Owner items

1. Register as an IRIS integrator; confirm sandbox and production base URLs, paths and headers.
2. GSTN e-invoice API user name and password for each GSTIN (plus the client id and secret IRIS issues).
3. An Indian static-IP VPS, with that IP whitelisted at the IRP.
4. An e-way bill ASP account, needed for e-way bill cancel and extension.
5. Run the relay against the sandbox before any production use.
