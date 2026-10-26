/** `waitlist.submit` accepts at most this many characters of notes. */
export const REQUEST_NOTES_MAX = 500;

export type RequestNotesInput = {
  lines?: string;
  date?: string;
  time?: string;
  notes?: string;
};

/**
 * The access request's extra fields packed into the one `notes` column the
 * server stores. Labels stay English: Godseye staff read them whatever
 * language the requester used. Returns undefined when nothing was filled in,
 * and never more than the server accepts (the person's own words are cut
 * first).
 */
export function composeRequestNotes(input: RequestNotesInput): string | undefined {
  const lines = input.lines?.trim();
  const slot = [input.date?.trim(), input.time?.trim()].filter(Boolean).join(" ");
  const own = input.notes?.trim();

  const header = [lines ? `Extrusion lines: ${lines}` : "", slot ? `Preferred time: ${slot}` : ""].filter(Boolean);
  const text = [header.join("\n"), own ?? ""].filter(Boolean).join("\n\n");
  if (!text) return undefined;
  return text.length > REQUEST_NOTES_MAX ? text.slice(0, REQUEST_NOTES_MAX) : text;
}
