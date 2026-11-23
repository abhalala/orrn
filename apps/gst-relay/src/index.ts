import { createApp } from "./app";
import { fileCredentialStore } from "./credentials";
import { nicStyleUpstream } from "./upstream";

/**
 * IRIS sandbox base URL. PLACEHOLDER: the owner must confirm the exact host and path prefix when
 * registering as an IRIS integrator. Override with IRP_BASE_URL. Production is the IRIS production URL.
 */
const DEFAULT_IRP_BASE_URL = "https://einvoice-sandbox.irisgst.com";

function die(msg: string): never {
  console.error(`gst-relay: ${msg}`);
  process.exit(1);
}

const credFile = process.env.GST_CREDENTIALS_FILE;
if (!credFile) die("GST_CREDENTIALS_FILE is required");
const publicKeyPem = process.env.IRP_PUBLIC_KEY_PEM;
if (!publicKeyPem) die("IRP_PUBLIC_KEY_PEM is required (the IRP's RSA public key, PEM)");

const port = Number(process.env.RELAY_PORT ?? 8787);
const host = process.env.RELAY_HOST ?? "127.0.0.1";

let credentials;
try {
  credentials = fileCredentialStore(credFile);
} catch (e) {
  die(e instanceof Error ? e.message : "cannot load credentials");
}

// Review S2: no shared secret here. Each tenant's key lives in the credentials file, bound to its GSTINs.
const app = createApp({
  credentials,
  upstream: nicStyleUpstream({ baseUrl: process.env.IRP_BASE_URL ?? DEFAULT_IRP_BASE_URL, publicKeyPem }),
});

Bun.serve({ port, hostname: host, fetch: app.fetch });
console.log(`gst-relay listening on ${host}:${port}`);
