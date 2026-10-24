/** How each packing list file is shared. iOS needs the UTI, Android the MIME type; they are not interchangeable. */
export const PL_SHARE_TARGETS = {
  pdf: { mimeType: "application/pdf", UTI: "com.adobe.pdf", extension: "pdf" },
  xlsx: {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
    extension: "xlsx",
  },
} as const;

export type PlShareKind = keyof typeof PL_SHARE_TARGETS;

/** `packing-list-D-0007.xlsx`: the dispatch code with anything unsafe in a file name turned into dashes. */
export function plFileName(code: string, kind: PlShareKind): string {
  const safe = code.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "dispatch";
  return `packing-list-${safe}.${PL_SHARE_TARGETS[kind].extension}`;
}
