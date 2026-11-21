/**
 * Links to an import's review page (design 2026-11-18, §12.1). Web routes:
 * `apps/web/src/routes/_tenant/ingest.review.$candidateId.tsx` and `ingest.files.$artifactId.tsx`.
 */
import { webBaseUrl } from "../webUrl";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function reviewPath(target: { candidateId?: unknown; artifactId?: unknown }): string | null {
  if (typeof target.candidateId === "string" && ID.test(target.candidateId)) {
    return `/ingest/review/${encodeURIComponent(target.candidateId)}`;
  }
  if (typeof target.artifactId === "string" && ID.test(target.artifactId)) {
    return `/ingest/files/${encodeURIComponent(target.artifactId)}`;
  }
  return null;
}

/** The plant's web host plus the path, for Hermes (it may show the link in Telegram too). */
export function absoluteLink(path: string): string {
  return `${webBaseUrl()}${path}`;
}

/** The review page of an import draft (an `ingest.*` path or a composite `import.*` one), from its input (`candidateId` first, else `artifactId`). */
export function draftLink(path: string, input: unknown): string | null {
  if (!(path.startsWith("ingest.") || path.startsWith("import.")) || !input || typeof input !== "object") return null;
  return reviewPath(input as Record<string, unknown>);
}
