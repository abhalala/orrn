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

async function importAesKey(masterKeyBase64: string) {
  const raw = base64ToBytes(masterKeyBase64);
  if (raw.byteLength !== 32) {
    throw new Error("ORRN_MASTER_KEY must be a base64-encoded 32-byte key");
  }

  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
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
