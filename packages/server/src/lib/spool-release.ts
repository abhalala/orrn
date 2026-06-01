import type { Platform } from "./spool-packager";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_REPO = "abhalala/orrn-spool";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

const PLATFORM_MARKERS: Record<Platform, readonly string[]> = {
  "linux-amd64": ["linux-amd64", "linux-x86_64", "linux-amd64.bin"],
  "darwin-amd64": ["darwin-amd64", "darwin-x86_64", "macos-amd64", "darwin-x64"],
  "darwin-arm64": ["darwin-arm64", "darwin-aarch64", "macos-arm64", "darwin-arm"],
  "windows-amd64": ["windows-amd64", "windows-x86_64", "windows-amd64.exe", "windows-x64.exe"],
};

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "orrn-server",
  };
}

function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function findBinaryAsset(assets: GitHubReleaseAsset[], platform: Platform): GitHubReleaseAsset | null {
  const markers = PLATFORM_MARKERS[platform];
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if (!name.startsWith("orrn-spool")) continue;
    if (name.endsWith(".sha256") || name.endsWith(".sig") || name.endsWith(".txt")) continue;
    if (markers.some((marker) => name.includes(marker))) {
      return asset;
    }
  }
  return null;
}

function findChecksumAsset(assets: GitHubReleaseAsset[], binaryAsset: GitHubReleaseAsset): GitHubReleaseAsset | null {
  const binaryName = binaryAsset.name.toLowerCase();
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if (!name.endsWith(".sha256")) continue;
    if (name === `${binaryName}.sha256` || name.includes(binaryName)) {
      return asset;
    }
  }
  return null;
}

async function fetchRelease(version?: string): Promise<GitHubRelease | null> {
  const path = version
    ? `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/releases/tags/v${normalizeVersion(version)}`
    : `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/releases/latest`;

  const response = await fetch(path, { headers: githubHeaders() });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status} ${response.statusText})`);
  }
  return (await response.json()) as GitHubRelease;
}

export function normalizePlatform(platform: string | null | undefined): Platform | null {
  if (!platform) return null;
  const value = platform.toLowerCase();
  if (value === "linux-amd64" || value === "darwin-amd64" || value === "darwin-arm64" || value === "windows-amd64") {
    return value;
  }
  if (value.includes("darwin") || value.includes("mac")) {
    return value.includes("arm") || value.includes("aarch64") ? "darwin-arm64" : "darwin-amd64";
  }
  if (value.includes("win")) {
    return "windows-amd64";
  }
  if (value.includes("linux")) {
    return "linux-amd64";
  }
  return null;
}

export async function resolveSpoolRelease(platform: Platform, version?: string): Promise<{
  version: string;
  downloadUrl: string;
  checksum: string | null;
} | null> {
  const release = await fetchRelease(version);
  if (!release) {
    if (version) {
      throw new Error(`No GitHub release tagged v${normalizeVersion(version)} exists in ${GITHUB_REPO}.`);
    }
    throw new Error(`No GitHub releases are published in ${GITHUB_REPO}.`);
  }

  const binaryAsset = findBinaryAsset(release.assets ?? [], platform);
  if (!binaryAsset) {
    throw new Error(`GitHub release ${release.tag_name} in ${GITHUB_REPO} has no binary asset for ${platform}.`);
  }

  let checksum: string | null = null;
  const checksumAsset = findChecksumAsset(release.assets ?? [], binaryAsset);
  if (checksumAsset) {
    const checksumResponse = await fetch(checksumAsset.browser_download_url, {
      headers: githubHeaders(),
      redirect: "follow",
    });
    if (checksumResponse.ok) {
      checksum = (await checksumResponse.text()).trim().split(/\s+/)[0] ?? null;
    }
  }

  return {
    version: normalizeVersion(release.tag_name),
    downloadUrl: binaryAsset.browser_download_url,
    checksum,
  };
}

export async function fetchSpoolBinary(downloadUrl: string): Promise<Uint8Array> {
  const response = await fetch(downloadUrl, {
    headers: githubHeaders(),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`GitHub binary download failed (${response.status} ${response.statusText})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
