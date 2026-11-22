import { reviewPath } from "./draft-card";

/** A finished reply as plain text with the import links in it (review S7). Nothing else becomes a link. */
export type ReplyPart = { kind: "text"; text: string } | { kind: "link"; text: string; path: string };

/**
 * A Markdown link, an angle-bracket link, a full URL, or a bare `/ingest/review|files/<id>` path. Each is only a
 * candidate: it becomes a link when `reviewPath` accepts it (this web host, an import page). Everything else in the
 * reply stays as the plain text Hermes wrote, so a reply can never draw an image or a link to another host.
 */
const CANDIDATE =
  /\[([^\]\n]{1,200})\]\(([^()\s]{1,500})\)|<((?:https?:\/\/|\/)[^<>\s]{1,500})>|(https?:\/\/[^\s<>()[\]"'`]{1,500}|(?<![\w/.-])\/ingest\/(?:review|files)\/[A-Za-z0-9_-]+\/?)/g;

/** Sentence punctuation and Markdown marks that end a bare link but are not part of it. */
const TRAILING = /[.,;:!?*_`)\]'"]+$/;

/** Markdown marks that may wrap a link: dropped only around a link that was recognised. */
const WRAPS = ["**", "__", "`", "*", "_"] as const;

export function replyParts(reply: string, origin?: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  const push = (part: ReplyPart) => {
    const prev = parts.at(-1);
    if (part.kind === "text" && prev?.kind === "text") prev.text += part.text;
    else if (part.kind === "text" && part.text === "") return;
    else parts.push(part);
  };
  for (const m of reply.matchAll(CANDIDATE)) {
    const start = m.index ?? 0;
    let raw = m[2] ?? m[3] ?? m[4] ?? "";
    let end = start + m[0].length;
    let label: string | null = m[1] ?? null;
    if (m[4] !== undefined) {
      const trail = TRAILING.exec(raw)?.[0] ?? "";
      raw = raw.slice(0, raw.length - trail.length);
      end -= trail.length;
    }
    const path = reviewPath(raw, origin);
    if (!path) continue;
    let before = reply.slice(last, start);
    let after = end;
    for (const w of WRAPS) {
      if (before.endsWith(w) && reply.startsWith(w, after)) {
        before = before.slice(0, before.length - w.length);
        after += w.length;
        break;
      }
    }
    push({ kind: "text", text: before });
    if (label !== null) label = label.replace(/^[*_`]+|[*_`]+$/g, "") || raw;
    push({ kind: "link", text: label ?? raw, path });
    last = after;
  }
  push({ kind: "text", text: reply.slice(last) });
  return parts;
}
