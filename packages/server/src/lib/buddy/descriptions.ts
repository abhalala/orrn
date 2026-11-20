/**
 * One line per procedure in plant words, for `orrn_search`, `orrn_describe` and the draft card title
 * (design 2026-11-18, §4.2). Hand-kept; a path missing here gets words built from the path. A missing
 * description is not a failure (`test/buddy-registry.test.ts` only lists them).
 */
export const buddyDescriptions: Record<string, string> = {
  // Import tools (§12.1).
  "ingest.status": "Import status: whether the file vault and the layout reader are set up, and open work.",
  "ingest.artifact.list": "List the import files and the state of each.",
  "ingest.artifact.get": "One import file: its tables, the period it covers and its state.",
  "ingest.candidate.list": "List the import tables (candidates) and their state.",
  "ingest.candidate.get": "One import table: what it is read as, its fit against the plant's data and open questions.",
  "ingest.rows.list": "The rows staged from an import table, with what was refused and why.",
  "ingest.rows.doubts": "Rows of an import table the importer is not sure about.",
  "ingest.hole.list": "What a finished merge left open.",
  "ingest.merge.get": "The state of a merge run.",
  "ingest.provenance.forRecord": "Which import file a record came from.",
  "ingest.shape.make": "Read the layout of an import table with the model (counts against the plant's model limits).",
  "ingest.period.confirm": "Answer the importer: the period (financial year or dates) an import file covers.",
  "ingest.answer.set": "Answer one of the importer's questions about an import table.",
  "ingest.rows.answerDoubts": "Answer the importer about rows it is not sure of.",
  "ingest.candidate.confirmNear": "Answer the importer: a near match is the same customer, die or vendor.",
  "ingest.candidate.setTarget": "Answer the importer: what kind of record an import table holds.",
  "ingest.candidate.hold": "Put an import table on hold.",
  "ingest.candidate.release": "Take an import table off hold.",
  "ingest.dryRun.step": "Try an import table against the plant's data without writing (dry run).",
  "ingest.vision.readPage": "Read one uploaded page image of a PDF or photo with the model.",
  "ingest.vision.pages": "The pages of a PDF or photo import and the state of each.",
};

const SPLIT = /(?<=[a-z0-9])(?=[A-Z])/;

/** Plain words from a path: `orders.lines.addLine` -> "orders: lines add line". */
export function wordsFromPath(path: string): string {
  const [head, ...rest] = path.split(".");
  const words = rest.flatMap((p) => p.split(SPLIT)).map((w) => w.toLowerCase());
  return words.length ? `${head}: ${words.join(" ")}` : (head ?? path);
}

export function describePath(path: string): string {
  return Object.prototype.hasOwnProperty.call(buddyDescriptions, path) ? buddyDescriptions[path]! : wordsFromPath(path);
}
