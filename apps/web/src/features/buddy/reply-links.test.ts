import { describe, expect, test } from "bun:test";

import { replyParts } from "./reply-links";

const origin = "https://app.orrn.in";

describe("review links in a finished reply (S7)", () => {
  test("a full link on this host to an import page becomes a link; the sentence's full stop stays text", () => {
    expect(replyParts("Done. Open https://app.orrn.in/ingest/review/cand_42.", origin)).toEqual([
      { kind: "text", text: "Done. Open " },
      { kind: "link", text: "https://app.orrn.in/ingest/review/cand_42", path: "/ingest/review/cand_42" },
      { kind: "text", text: "." },
    ]);
  });

  test("a bare path works too", () => {
    expect(replyParts("See /ingest/files/art-7 for the file", origin)).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "/ingest/files/art-7", path: "/ingest/files/art-7" },
      { kind: "text", text: " for the file" },
    ]);
  });

  test("Markdown around a recognised link is dropped (N6, cheap part)", () => {
    expect(replyParts("Next: [the review page](https://app.orrn.in/ingest/review/c1) and **https://app.orrn.in/ingest/files/a1**", origin)).toEqual([
      { kind: "text", text: "Next: " },
      { kind: "link", text: "the review page", path: "/ingest/review/c1" },
      { kind: "text", text: " and " },
      { kind: "link", text: "https://app.orrn.in/ingest/files/a1", path: "/ingest/files/a1" },
    ]);
    expect(replyParts("Open <https://app.orrn.in/ingest/review/c1> or `/ingest/review/c2`", origin)).toEqual([
      { kind: "text", text: "Open " },
      { kind: "link", text: "https://app.orrn.in/ingest/review/c1", path: "/ingest/review/c1" },
      { kind: "text", text: " or " },
      { kind: "link", text: "/ingest/review/c2", path: "/ingest/review/c2" },
    ]);
  });

  test("another host, another page, or a Markdown link to elsewhere stays plain text, as Hermes wrote it", () => {
    const text = "Try https://evil.example/ingest/review/x or [here](https://evil.example/a) or /settings?tab=buddy or https://app.orrn.in/stock";
    expect(replyParts(text, origin)).toEqual([{ kind: "text", text }]);
  });

  test("a reply with no link is one text part; an empty reply has no parts", () => {
    expect(replyParts("About 500 kg in Y1.", origin)).toEqual([{ kind: "text", text: "About 500 kg in Y1." }]);
    expect(replyParts("", origin)).toEqual([]);
  });
});
