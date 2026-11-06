const version = "v1";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The all-zero key local dev uses (apps/server/wrangler.local.jsonc). It is in the source, so it is
 * public: never valid outside development (security review 2026-11-04).
 */
export const PUBLIC_DEV_MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** True for a missing or blank key and for any spelling of the all-zero key. */
export function isUnsafeMasterKey(masterKey: string | null | undefined): boolean {
  const normalized = masterKey?.trim() ?? "";
  if (!normalized) return true;
  try {
    const decoded = base64ToBytes(normalized);
    return decoded.byteLength === 32 && decoded.every((byte) => byte === 0);
  } catch {
    return false;
  }
}

async function importAesKey(masterKey: string) {
  const normalized = masterKey.trim();
  if (!normalized) {
    throw new Error("ORRN_MASTER_KEY is required");
  }

  let raw: Uint8Array | null = null;
  try {
    const decoded = base64ToBytes(normalized);
    if (decoded.byteLength === 32) {
      raw = decoded;
    }
  } catch {
    // Fall through to raw-string derivation.
  }

  if (!raw) {
    raw = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)),
    );
  }

  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function wrapSecret(plaintext: string, masterKeyBase64: string) {
  const key = await importAesKey(masterKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.byteLength);

  return `${version}:${bytesToBase64(packed)}`;
}

export async function unwrapSecret(wrapped: string, masterKeyBase64: string) {
  const [wrappedVersion, payload] = wrapped.split(":");
  if (wrappedVersion !== version || !payload) {
    throw new Error("Unsupported wrapped secret format");
  }

  const packed = base64ToBytes(payload);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const key = await importAesKey(masterKeyBase64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  return new TextDecoder().decode(plaintext);
}
