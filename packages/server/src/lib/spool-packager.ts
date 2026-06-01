/**
 * Spool deliverable packager.
 *
 * Uses a Ninite-style approach: a single pre-built binary with deployment
 * config appended as a trailer. The Go binary reads its own executable,
 * detects the trailer, and uses the embedded config with highest priority.
 *
 * Trailer format (appended after the binary):
 *   [JSON config payload] [ORRN_SPOOL_V1\x00\x00\x00] [uint64 LE payload length]
 *
 * The binary is fetched from R2 (uploaded by orrn-spool CI), patched with
 * the deployment config, and streamed to the platform admin for download.
 */

export type Platform = "linux-amd64" | "darwin-amd64" | "darwin-arm64" | "windows-amd64";

export interface PackageConfig {
  instanceId: string;
  subdomain: string;
  spoolDomain: string;
  sharedSecret: string;
  cfTunnelToken: string;
  orrnServerUrl: string;
  tunnelEnabled: boolean;
  platform: Platform;
  spoolVersion: string;
}

/** Embedded config payload — matches Go's EmbeddedConfig struct. */
export interface EmbeddedConfig {
  instance_id: string;
  server_url: string;
  shared_secret: string;
  spool_domain: string;
  tunnel_enabled: boolean;
  tunnel_token: string;
}

/** Trailer magic — must match Go's TrailerMagic constant exactly. */
const TRAILER_MAGIC = "ORRN_SPOOL_V1\x00\x00\x00"; // 16 bytes

/**
 * R2 key for a release binary.
 * Format: releases/spool/v{version}/{platform}/orrn-spool[.exe]
 */
export function getReleaseKey(platform: Platform, version: string): string {
  const ext = platform === "windows-amd64" ? ".exe" : "";
  return `releases/spool/v${version}/${platform}/orrn-spool${ext}`;
}

/**
 * Filename for the patched binary deliverable.
 */
export function getDeliverableFilename(subdomain: string, platform: Platform): string {
  const ext = platform === "windows-amd64" ? ".exe" : "";
  return `orrn-spool-${subdomain}-${platform}${ext}`;
}

/**
 * Build the embedded config JSON from a PackageConfig.
 */
export function buildEmbeddedConfig(config: PackageConfig): EmbeddedConfig {
  return {
    instance_id: config.instanceId,
    server_url: config.orrnServerUrl,
    shared_secret: config.sharedSecret,
    spool_domain: config.spoolDomain,
    tunnel_enabled: config.tunnelEnabled,
    tunnel_token: config.cfTunnelToken,
  };
}

/**
 * Patch a binary buffer by appending the embedded config trailer.
 *
 * The trailer format is:
 *   [JSON payload bytes] [16-byte magic] [8-byte LE uint64 payload length]
 *
 * The Go binary reads its own executable backwards:
 * 1. Read last 24 bytes (magic + length)
 * 2. Verify magic matches ORRN_SPOOL_V1
 * 3. Read payload of the specified length
 * 4. Parse JSON into EmbeddedConfig
 */
export function patchBinaryWithConfig(binary: Uint8Array, config: PackageConfig): Uint8Array {
  const embedded = buildEmbeddedConfig(config);
  const jsonPayload = new TextEncoder().encode(JSON.stringify(embedded));

  // Total trailer: JSON payload + 16-byte magic + 8-byte length
  const totalLength = binary.length + jsonPayload.length + TRAILER_MAGIC.length + 8;
  const result = new Uint8Array(totalLength);

  // Copy original binary
  result.set(binary, 0);

  // Copy JSON payload
  let offset = binary.length;
  result.set(jsonPayload, offset);
  offset += jsonPayload.length;

  // Copy magic (16 bytes)
  const magicBytes = new TextEncoder().encode(TRAILER_MAGIC);
  result.set(magicBytes, offset);
  offset += TRAILER_MAGIC.length;

  // Append payload length as uint64 LE (8 bytes)
  const lengthView = new DataView(result.buffer, result.byteOffset + offset, 8);
  // JavaScript numbers are safe up to 2^53, which is more than enough for payload length
  lengthView.setBigUint64(0, BigInt(jsonPayload.length), true); // little-endian

  return result;
}

/**
 * List of all supported platforms.
 */
export const SUPPORTED_PLATFORMS: Platform[] = [
  "linux-amd64",
  "darwin-amd64",
  "darwin-arm64",
  "windows-amd64",
];