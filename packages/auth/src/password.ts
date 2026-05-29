import {
  verifyPassword as verifyLegacyPassword,
} from "@better-auth/utils/password";
import { hex } from "@better-auth/utils/hex";
import { scryptAsync } from "@noble/hashes/scrypt.js";

/** Prefix for hashes created with lower scrypt cost (Worker-safe). */
const WORKER_PREFIX = "w8:";

const workerScrypt = {
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 64,
  maxmem: 128 * 16384 * 8 * 2,
} as const;

async function workerGenerateKey(password: string, saltHex: string) {
  return scryptAsync(password.normalize("NFKC"), saltHex, workerScrypt);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = hex.encode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await workerGenerateKey(password, salt);
  return `${WORKER_PREFIX}${salt}:${hex.encode(key)}`;
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (hash.startsWith(WORKER_PREFIX)) {
    const body = hash.slice(WORKER_PREFIX.length);
    const [salt, key] = body.split(":");
    if (!salt || !key) {
      return false;
    }
    const targetKey = await workerGenerateKey(password, salt);
    return hex.encode(targetKey) === key;
  }

  return verifyLegacyPassword(hash, password);
}
